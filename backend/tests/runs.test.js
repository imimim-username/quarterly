'use strict';

/**
 * runs.test.js — Integration tests for POST/GET/DELETE /api/runs.
 * Requires better-sqlite3 native module; tests are skipped in environments
 * where the native module cannot be compiled.
 */

let request, express, runsRoutes, Database;
let nativeAvailable = false;

try {
  Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.close();
  nativeAvailable = true;
} catch (e) {
  // Native module not available
}

if (nativeAvailable) {
  request = require('supertest');
  express = require('express');
  runsRoutes = require('../src/routes/runs');

  const ENDPOINT = 'http://127.0.0.1:9998';
  const GQL_PATH = '/graphql';

  // Mock a native-fetch-compatible Response object
  function mockResponse(data, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  let _realFetch;
  beforeEach(() => {
    _realFetch = global.fetch;
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = _realFetch;
  });

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'General', gql TEXT NOT NULL,
        variable_defs TEXT NOT NULL DEFAULT '[]', result_path TEXT NOT NULL,
        pagination_style TEXT NOT NULL DEFAULT 'offset', cursor_path TEXT NOT NULL DEFAULT '',
        has_next_path TEXT NOT NULL DEFAULT '', date_format TEXT NOT NULL DEFAULT 'unix_seconds',
        chain_mode TEXT NOT NULL DEFAULT 'filter', chain_var_name TEXT NOT NULL DEFAULT 'chain',
        chain_field TEXT NOT NULL DEFAULT 'chain', field_meta TEXT NOT NULL DEFAULT '{}',
        key_field TEXT NOT NULL DEFAULT 'id', is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        query_id INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL, start_date TEXT, end_date TEXT,
        variables_base TEXT NOT NULL, rows TEXT, row_count INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
        error_type TEXT, error_message TEXT, graphql_errors TEXT, warnings TEXT,
        notes TEXT,
        ran_at TEXT NOT NULL
      );
    `);
    // Set endpoint in settings
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('endpoint', ?)").run(ENDPOINT + GQL_PATH);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('page_size', '1000')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_page_count', '50')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_row_count', '50000')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timeout_per_page_ms', '30000')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('warn_bytes', '1048576')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_bytes', '10485760')").run();
    return db;
  }

  function makeQuery(db) {
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO queries (name, gql, result_path, pagination_style, variable_defs,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('Test Query', '{ items { id } }', 'data.items', 'offset', '[]', now, now);
    return info.lastInsertRowid;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/runs', runsRoutes(db));
    return app;
  }

  describe('POST /api/runs — valid run saved', () => {
    test('valid run returns rows and saves to DB', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      global.fetch
        .mockResolvedValueOnce(mockResponse({ data: { items: [{ id: '1' }, { id: '2' }] } }))
        .mockResolvedValueOnce(mockResponse({ data: { items: [] } }));

      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: queryId });
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.id).toBeTruthy();
      expect(res.body.error_type).toBeNull();
      db.close();
    });
  });

  describe('POST /api/runs — error cases', () => {
    test('invalid query_id → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: 9999 });
      expect(res.status).toBe(400);
      expect(res.body.error_type).toBe('invalid_query');
      db.close();
    });

    test('endpoint unreachable → 502, not saved', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: queryId });
      expect(res.status).toBe(502);
      expect(res.body.error_type).toBe('network');
      expect(res.body.id).toBeNull();
      db.close();
    });

    test('GraphQL errors only → 400, not saved', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      global.fetch.mockResolvedValueOnce(mockResponse({
        errors: [{ message: 'Unknown field' }],
      }));

      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: queryId });
      expect(res.status).toBe(400);
      expect(res.body.error_type).toBe('graphql');
      expect(res.body.id).toBeNull();
      db.close();
    });
  });

  describe('POST /api/runs — warnings and size', () => {
    test('result > warn_bytes → 200, saved, warnings non-empty', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      // Build a response large enough to trigger warn_bytes (1MB default)
      const bigRow = { id: '1', data: 'x'.repeat(2000000) }; // ~2MB
      global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: [bigRow] } }));

      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: queryId });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
      expect(res.body.warnings.length).toBeGreaterThan(0);
      db.close();
    });
  });

  describe('POST /api/runs — variables_base excludes pagination vars', () => {
    test('pagination variables (first, skip) not in variables_base', async () => {
      const db = makeDb();
      const now = new Date().toISOString();
      // Create a query with pagination variable defs
      const info = db.prepare(`
        INSERT INTO queries (name, gql, result_path, pagination_style, variable_defs, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'Paginated', '{ items { id } }', 'data.items', 'offset',
        JSON.stringify([
          { name: 'first', source: 'pagination_first', type: 'Int' },
          { name: 'skip', source: 'pagination_skip', type: 'Int' },
          { name: 'filter', source: 'user', default: 'active', type: 'String' },
        ]),
        now, now
      );
      const queryId = info.lastInsertRowid;

      global.fetch
        .mockResolvedValueOnce(mockResponse({ data: { items: [{ id: '1' }] } }))
        .mockResolvedValueOnce(mockResponse({ data: { items: [] } }));

      const app = makeApp(db);
      const res = await request(app).post('/api/runs').send({ query_id: queryId });
      expect(res.status).toBe(200);
      const varsBase = res.body.variables_base;
      expect(varsBase.first).toBeUndefined();
      expect(varsBase.skip).toBeUndefined();
      expect(varsBase.filter).toBe('active');
      db.close();
    });
  });

  describe('GET /api/runs', () => {
    test('list returns newest first', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, ?)
      `).run(queryId, ENDPOINT + GQL_PATH, '2024-01-01T00:00:00.000Z');
      db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, ?)
      `).run(queryId, ENDPOINT + GQL_PATH, '2024-06-01T00:00:00.000Z');

      const app = makeApp(db);
      const res = await request(app).get(`/api/runs?query_id=${queryId}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      // Newest first
      expect(res.body[0].ran_at > res.body[1].ran_at).toBe(true);
      db.close();
    });

    test('GET single run includes rows', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const rowsJson = JSON.stringify([{ id: '1' }]);
      const info = db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, rows, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', ?, 1, 1, 100, datetime('now'))
      `).run(queryId, ENDPOINT + GQL_PATH, rowsJson);

      const app = makeApp(db);
      const res = await request(app).get(`/api/runs/${info.lastInsertRowid}`);
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].id).toBe('1');
      db.close();
    });

    test('DELETE removes run', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const info = db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, datetime('now'))
      `).run(queryId, ENDPOINT + GQL_PATH);
      const runId = info.lastInsertRowid;

      const app = makeApp(db);
      const del = await request(app).delete(`/api/runs/${runId}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/runs/${runId}`);
      expect(get.status).toBe(404);
      db.close();
    });
  });

  describe('PATCH /api/runs/:id — notes', () => {
    test('PATCH with { notes: "test note" } → 200 { ok: true }, note persisted', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const info = db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, datetime('now'))
      `).run(queryId, 'http://127.0.0.1:9998/graphql');
      const runId = info.lastInsertRowid;

      const app = makeApp(db);
      const patch = await request(app).patch(`/api/runs/${runId}`).send({ notes: 'test note' });
      expect(patch.status).toBe(200);
      expect(patch.body).toEqual({ ok: true });

      const get = await request(app).get(`/api/runs/${runId}`);
      expect(get.status).toBe(200);
      expect(get.body.notes).toBe('test note');
      db.close();
    });

    test('PATCH with { notes: null } → 200, clears note', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const info = db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, notes, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, 'existing note', datetime('now'))
      `).run(queryId, 'http://127.0.0.1:9998/graphql');
      const runId = info.lastInsertRowid;

      const app = makeApp(db);
      const patch = await request(app).patch(`/api/runs/${runId}`).send({ notes: null });
      expect(patch.status).toBe(200);
      expect(patch.body).toEqual({ ok: true });

      const get = await request(app).get(`/api/runs/${runId}`);
      expect(get.status).toBe(200);
      expect(get.body.notes).toBeNull();
      db.close();
    });

    test('PATCH /api/runs/9999 → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).patch('/api/runs/9999').send({ notes: 'ghost' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });

    test('PATCH with { notes: 123 } (non-string) → 400 validation error', async () => {
      const db = makeDb();
      const queryId = makeQuery(db);
      const info = db.prepare(`
        INSERT INTO runs (query_id, endpoint, variables_base, row_count, page_count, duration_ms, ran_at)
        VALUES (?, ?, '{}', 0, 0, 100, datetime('now'))
      `).run(queryId, 'http://127.0.0.1:9998/graphql');
      const runId = info.lastInsertRowid;

      const app = makeApp(db);
      const res = await request(app).patch(`/api/runs/${runId}`).send({ notes: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });
  });

} else {
  describe('runs.test.js — DB integration', () => {
    test.skip('valid run saved, rows non-null (skipped: better-sqlite3 native unavailable)', () => {});
    test.skip('invalid query_id → 400 (skipped)', () => {});
    test.skip('endpoint unreachable → 502, not saved (skipped)', () => {});
    test.skip('GraphQL errors only → 400, not saved (skipped)', () => {});
    test.skip('result 1.5 MB → 200, saved, warnings non-empty (skipped)', () => {});
    test.skip('result 11 MB → 413, not saved (skipped)', () => {});
    test.skip('variables_base excludes pagination variables (skipped)', () => {});
    test.skip('GET list newest-first (skipped)', () => {});
    test.skip('GET single includes rows (skipped)', () => {});
    test.skip('DELETE removes (skipped)', () => {});
    test.skip('PATCH /api/runs/:id — notes: sets note (skipped)', () => {});
    test.skip('PATCH /api/runs/:id — notes: clears note (skipped)', () => {});
    test.skip('PATCH /api/runs/:id — notes: 404 for missing run (skipped)', () => {});
    test.skip('PATCH /api/runs/:id — notes: 400 for non-string (skipped)', () => {});
  });
}
