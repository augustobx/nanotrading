/**
 * OFFLINE ONE-TIME VAULT MIGRATION — no API calls.
 *
 * Preflight: stop the trading backend, take an additional off-host backup,
 * export CONFIG_MASTER_KEY and LEGACY_VAULT_SECRET in the temporary shell.
 * Dry run: npx tsx scripts/migrate-vault-key.ts
 * Apply:   OFFLINE_VAULT_MIGRATION=YES npx tsx scripts/migrate-vault-key.ts --apply
 *
 * Never store either secret in Git, CLI args or logs. Destroy old key after
 * verifying service restart and credentials functionality.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DB_SQLITE_PATH;
const newSecret = process.env.CONFIG_MASTER_KEY;
const oldSecret = process.env.LEGACY_VAULT_SECRET;
const apply = process.argv.includes('--apply');

if (!dbPath || !fs.existsSync(dbPath) ||
    !newSecret || Buffer.byteLength(newSecret, 'utf8') < 32 ||
    !oldSecret || oldSecret === newSecret) {
  throw new Error('Falta DB_SQLITE_PATH válido, CONFIG_MASTER_KEY de 32+ bytes o LEGACY_VAULT_SECRET diferente');
}
if (apply && process.env.OFFLINE_VAULT_MIGRATION !== 'YES') {
  throw new Error('La migración de escritura exige OFFLINE_VAULT_MIGRATION=YES con el backend detenido');
}

const salt = Buffer.from('nanolabs_ai_trading_vault_salt_v1', 'utf8');
const derive = (secret: string) => crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
const oldKey = derive(oldSecret);
const newKey = derive(newSecret);
type Cipher = { ciphertext: string; iv: string; authTag: string };
const decrypt = (payload: Cipher, key: Buffer): string => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  return decipher.update(payload.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
};
const encrypt = (plaintext: string): Cipher => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
  const ciphertext = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return { iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), ciphertext };
};

const db = new DatabaseSync(dbPath);
try {
  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('Integridad SQLite falló; NO migrar');
  }
  const sources = [
    { table: 'bybit_credentials', key: 'id' },
    { table: 'ai_provider_credentials', key: 'provider' },
  ];
  const updates: Array<{ table: string; key: string; id: string; encrypted: string }> = [];

  for (const source of sources) {
    const rows = db.prepare(`SELECT ${source.key} AS id, encrypted_secret FROM ${source.table}`).all() as
      Array<{ id: string; encrypted_secret: string }>;
    for (const row of rows) {
      const plaintext = decrypt(JSON.parse(row.encrypted_secret) as Cipher, oldKey);
      if (!plaintext) throw new Error('La credencial cifrada está vacía; abortando');
      const next = encrypt(plaintext);
      if (decrypt(next, newKey) !== plaintext) throw new Error('Verificación criptográfica de rotación falló');
      updates.push({ table: source.table, key: source.key, id: row.id, encrypted: JSON.stringify(next) });
    }
  }

  console.log(`Verificadas ${updates.length} credenciales sin revelar secretos. Modo: ${apply ? 'APPLY' : 'DRY_RUN'}.`);
  if (apply) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const backupPath = `${dbPath}.pre-vault-${timestamp}.sqlite`;
    fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backupPath, 0o600);
    console.log(`Backup pre-migración: ${backupPath}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of updates) {
        db.prepare(`UPDATE ${row.table} SET encrypted_secret = ? WHERE ${row.key} = ?`).run(row.encrypted, row.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log('Rotación completa. Reiniciar backend y verificar accesos antes de eliminar backup.');
  }
} finally {
  db.close();
}
