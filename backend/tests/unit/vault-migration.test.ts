import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('Audit vault: dry-run is nonmutating, offline apply rotates both providers and creates backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanotrading-vault-'));
  const filename = path.join(dir, 'trading.db');
  const previous = 'legacy-example-secret-32-bytes-long-test';
  const next = 'new-example-secret-random-32-bytes-2026-test';
  const derive = (secret: string) => crypto.pbkdf2Sync(secret,
    Buffer.from('nanolabs_ai_trading_vault_salt_v1'), 100000, 32, 'sha256');
  const encrypt = (value: string, secret: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', derive(secret), iv);
    const ciphertext = cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
    return JSON.stringify({ iv: iv.toString('hex'), ciphertext,
      authTag: cipher.getAuthTag().toString('hex') });
  };
  const decrypt = (encrypted: string, secret: string) => {
    const item = JSON.parse(encrypted);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive(secret),
      Buffer.from(item.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(item.authTag, 'hex'));
    return decipher.update(item.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  };

  try {
    const db = new DatabaseSync(filename);
    db.exec(`
      CREATE TABLE bybit_credentials (id TEXT PRIMARY KEY, encrypted_secret TEXT);
      CREATE TABLE ai_provider_credentials (provider TEXT PRIMARY KEY, encrypted_secret TEXT);
    `);
    db.prepare('INSERT INTO bybit_credentials (id, encrypted_secret) VALUES (?, ?)')
      .run('bybit', encrypt('bybit-test-secret', previous));
    db.prepare('INSERT INTO ai_provider_credentials (provider, encrypted_secret) VALUES (?, ?)')
      .run('openai', encrypt('openai-test-secret', previous));
    db.close();

    const env = {
      ...process.env, DB_SQLITE_PATH: filename, CONFIG_MASTER_KEY: next,
      LEGACY_VAULT_SECRET: previous,
    };
    const run = (apply: boolean) => spawnSync('npx', [
      '--no-install', 'tsx', 'scripts/migrate-vault-key.ts',
      ...(apply ? ['--apply'] : []),
    ], {
      cwd: process.cwd(), env: apply ? { ...env, OFFLINE_VAULT_MIGRATION: 'YES' } : env,
      encoding: 'utf8', timeout: 25000, shell: process.platform === 'win32',
    });

    const dry = run(false);
    assert.equal(dry.status, 0, dry.stderr);
    const afterDry = new DatabaseSync(filename);
    const oldRecord = afterDry.prepare('SELECT encrypted_secret FROM bybit_credentials')
      .get() as { encrypted_secret: string };
    assert.equal(decrypt(oldRecord.encrypted_secret, previous), 'bybit-test-secret');
    afterDry.close();

    const result = run(true);
    assert.equal(result.status, 0, result.stderr);
    const restored = new DatabaseSync(filename);
    const newBybit = restored.prepare('SELECT encrypted_secret FROM bybit_credentials')
      .get() as { encrypted_secret: string };
    const newAi = restored.prepare('SELECT encrypted_secret FROM ai_provider_credentials')
      .get() as { encrypted_secret: string };
    assert.equal(decrypt(newBybit.encrypted_secret, next), 'bybit-test-secret');
    assert.equal(decrypt(newAi.encrypted_secret, next), 'openai-test-secret');
    restored.close();
    const backups = fs.readdirSync(dir).filter(name => name.includes('pre-vault'));
    assert.equal(backups.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
