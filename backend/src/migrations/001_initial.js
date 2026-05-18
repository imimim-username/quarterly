'use strict';

/**
 * Migration 001 — baseline schema
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queries (
      id               INTEGER PRIMARY KEY,
      name             TEXT    NOT NULL,
      description      TEXT    NOT NULL DEFAULT '',
      category         TEXT    NOT NULL DEFAULT 'General',
      gql              TEXT    NOT NULL,
      variable_defs    TEXT    NOT NULL DEFAULT '[]',
      result_path      TEXT    NOT NULL,
      pagination_style TEXT    NOT NULL DEFAULT 'offset',
      cursor_path      TEXT    NOT NULL DEFAULT '',
      has_next_path    TEXT    NOT NULL DEFAULT '',
      date_format      TEXT    NOT NULL DEFAULT 'unix_seconds',
      chain_mode       TEXT    NOT NULL DEFAULT 'filter',
      chain_var_name   TEXT    NOT NULL DEFAULT 'chain',
      chain_field      TEXT    NOT NULL DEFAULT 'chain',
      field_meta       TEXT    NOT NULL DEFAULT '{}',
      key_field        TEXT    NOT NULL DEFAULT 'id',
      is_builtin       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id             INTEGER PRIMARY KEY,
      query_id       INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
      endpoint       TEXT    NOT NULL,
      start_date     TEXT,
      end_date       TEXT,
      variables_base TEXT    NOT NULL,
      rows           TEXT,
      row_count      INTEGER NOT NULL DEFAULT 0,
      page_count     INTEGER NOT NULL DEFAULT 0,
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      error_type     TEXT,
      error_message  TEXT,
      graphql_errors TEXT,
      warnings       TEXT,
      ran_at         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_queries (
      report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      query_id   INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (report_id, query_id)
    );

    CREATE TABLE IF NOT EXISTS report_runs (
      id         INTEGER PRIMARY KEY,
      report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      start_date TEXT,
      end_date   TEXT,
      endpoint   TEXT    NOT NULL,
      ran_at     TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_run_queries (
      report_run_id INTEGER NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
      query_id      INTEGER NOT NULL REFERENCES queries(id),
      run_id        INTEGER REFERENCES runs(id),
      status        TEXT    NOT NULL DEFAULT 'pending',
      error_message TEXT,
      PRIMARY KEY (report_run_id, query_id)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_query  ON runs(query_id, ran_at);
    CREATE INDEX IF NOT EXISTS idx_runs_ran_at ON runs(ran_at);
  `);

  // Insert default settings rows (only if not already present)
  const defaults = [
    ['endpoint', ''],
    ['warn_bytes', '1048576'],
    ['max_bytes', '10485760'],
    ['page_size', '1000'],
    ['max_page_count', '50'],
    ['max_row_count', '50000'],
    ['timeout_per_page_ms', '30000'],
    ['builtin_imported', '0'],
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of defaults) {
    insertSetting.run(key, value);
  }
}

module.exports = { up };
