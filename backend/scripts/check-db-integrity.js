import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const dbPath = path.resolve('backend/data/trading.db');
console.log('Checking database at:', dbPath);

const db = new DatabaseSync(dbPath);
const integrity = db.prepare('PRAGMA integrity_check').all();
console.log('Integrity check result:', JSON.stringify(integrity));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\nTables found (' + tables.length + '):');
for (const t of tables) {
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${t.name}`).get();
    console.log(` - ${t.name}: ${countRow.count} rows`);
  } catch (e) {
    console.log(` - ${t.name}: error reading (${e.message})`);
  }
}

db.close();
console.log('\nDatabase check finished.');
