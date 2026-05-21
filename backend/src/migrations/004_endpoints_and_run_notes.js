'use strict';
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      url        TEXT    NOT NULL DEFAULT '',
      headers    TEXT    NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );
  `);
  try { db.exec('ALTER TABLE runs ADD COLUMN notes TEXT'); } catch {}
}
module.exports = { up };
