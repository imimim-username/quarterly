'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'quarterly.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL mode MUST be the first pragma
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migration system
function runMigrations() {
  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER NOT NULL,
      applied_at TEXT    NOT NULL
    );
  `);

  const versionRow = db.prepare('SELECT MAX(version) as version FROM schema_version').get();
  const currentVersion = versionRow.version || 0;

  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter(f => /^\d{3}_.*\.js$/.test(f))
    .sort();

  for (const file of migrationFiles) {
    const versionNum = parseInt(file.slice(0, 3), 10);
    if (versionNum <= currentVersion) continue;

    const migration = require(path.join(migrationsDir, file));
    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        versionNum,
        new Date().toISOString()
      );
    });
    applyMigration();
    console.log(`Applied migration ${file}`);
  }
}

runMigrations();

module.exports = db;
