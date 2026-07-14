'use strict';

/**
 * Replace the simple report_queries join table with a richer report_instances table.
 *
 * Each instance stores:
 *  - query_id     : which query to run
 *  - position     : display/export order
 *  - label        : human-readable name for this instance (e.g. "ETH Deposits")
 *  - config       : JSON blob with full chart + filter config (see ReportInstanceCard)
 *
 * The old report_queries table is kept intact for backward compatibility
 * (existing run history still references it). New code only writes to report_instances.
 */
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS report_instances (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        query_id   INTEGER NOT NULL REFERENCES queries(id),
        position   INTEGER NOT NULL DEFAULT 0,
        label      TEXT    NOT NULL DEFAULT '',
        config     TEXT    NOT NULL DEFAULT '{}',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Add updated_at to reports so we can track last-modified
    try {
      db.exec(`ALTER TABLE reports ADD COLUMN updated_at TEXT DEFAULT NULL`);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  },
};
