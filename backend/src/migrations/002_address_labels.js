'use strict';

/**
 * Migration 002 — address_labels table
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS address_labels (
      id          INTEGER PRIMARY KEY,
      address     TEXT NOT NULL,
      chain       TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      notes       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE(address, chain)
    );

    CREATE INDEX IF NOT EXISTS idx_address_labels_address
      ON address_labels(address);
  `);
}

module.exports = { up };
