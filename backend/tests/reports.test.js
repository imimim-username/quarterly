'use strict';

/**
 * reports.test.js — Integration tests for /api/reports and /api/reports/:id/instances.
 * Also tests the FK-constraint fix in /api/queries DELETE.
 */

let request, express, reportsRoutes, queriesRoutes, Database;
let nativeAvailable = false;

try {
  Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.close();
  nativeAvailable = true;
} catch (e) {
  // Native module not available in this environment
}

if (nativeAvailable) {
  request  = require('supertest');
  express  = require('express');
  reportsRoutes = require('../src/routes/reports');
  queriesRoutes = require('../src/routes/queries');

  // ── Schema helper ──────────────────────────────────────────────────────────

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'General',
        gql TEXT NOT NULL,
        variable_defs TEXT NOT NULL DEFAULT '[]',
        result_path TEXT NOT NULL,
        pagination_style TEXT NOT NULL DEFAULT 'offset',
        cursor_path TEXT NOT NULL DEFAULT '',
        has_next_path TEXT NOT NULL DEFAULT '',
        date_format TEXT NOT NULL DEFAULT 'unix_seconds',
        chain_mode TEXT NOT NULL DEFAULT 'filter',
        chain_var_name TEXT NOT NULL DEFAULT 'chain',
        chain_field TEXT NOT NULL DEFAULT 'chain',
        field_meta TEXT NOT NULL DEFAULT '{}',
        key_field TEXT NOT NULL DEFAULT 'id',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        chart_views TEXT NOT NULL DEFAULT '[]',
        computed_columns TEXT NOT NULL DEFAULT '[]',
        timestamp_extraction TEXT
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS report_queries (
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        query_id  INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (report_id, query_id)
      );

      CREATE TABLE IF NOT EXISTS report_runs (
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        start_date TEXT, end_date TEXT,
        endpoint TEXT NOT NULL,
        ran_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS report_run_queries (
        report_run_id INTEGER NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
        query_id      INTEGER NOT NULL REFERENCES queries(id),
        run_id        INTEGER,
        status        TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        PRIMARY KEY (report_run_id, query_id)
      );

      CREATE TABLE IF NOT EXISTS report_instances (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        query_id  INTEGER NOT NULL REFERENCES queries(id),
        position  INTEGER NOT NULL DEFAULT 0,
        label     TEXT NOT NULL DEFAULT '',
        config    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES ('endpoint', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('builtin_imported', '0');
    `);
    return db;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/reports', reportsRoutes(db));
    app.use('/api/queries', queriesRoutes(db));
    return app;
  }

  // Seed helpers
  function createQuery(db, overrides = {}) {
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO queries (name, category, gql, result_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      overrides.name ?? 'Test Query',
      overrides.category ?? 'General',
      overrides.gql ?? '{ items { id } }',
      overrides.result_path ?? 'data.items',
      now, now
    );
    return info.lastInsertRowid;
  }

  function createReport(db, overrides = {}) {
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO reports (name, description, created_at) VALUES (?, ?, ?)
    `).run(overrides.name ?? 'Test Report', overrides.description ?? '', now);
    return info.lastInsertRowid;
  }

  // ── GET /api/reports ───────────────────────────────────────────────────────

  describe('GET /api/reports — empty', () => {
    test('returns empty array on fresh DB', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/reports');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });

    test('returns all reports ordered by name', async () => {
      const db = makeDb();
      const app = makeApp(db);
      createReport(db, { name: 'Zebra Report' });
      createReport(db, { name: 'Alpha Report' });
      const res = await request(app).get('/api/reports');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Alpha Report');
      expect(res.body[1].name).toBe('Zebra Report');
      db.close();
    });
  });

  // ── POST /api/reports ──────────────────────────────────────────────────────

  describe('POST /api/reports', () => {
    test('creates a report with name only', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/reports').send({ name: 'Q2 Summary' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.name).toBe('Q2 Summary');
      expect(res.body.description).toBe('');
      expect(res.body.instances).toEqual([]);
      db.close();
    });

    test('creates a report with name and description', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/reports').send({ name: 'My Report', description: 'For Q3' });
      expect(res.status).toBe(201);
      expect(res.body.description).toBe('For Q3');
      db.close();
    });

    test('missing name → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/reports').send({ description: 'No name' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    test('blank name → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/reports').send({ name: '   ' });
      expect(res.status).toBe(400);
      db.close();
    });
  });

  // ── GET /api/reports/:id ───────────────────────────────────────────────────

  describe('GET /api/reports/:id', () => {
    test('returns report with empty instances array', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = createReport(db);
      const res = await request(app).get(`/api/reports/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.instances).toEqual([]);
      db.close();
    });

    test('not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/reports/9999');
      expect(res.status).toBe(404);
      db.close();
    });

    test('returns instances with nested query object', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db, { name: 'Deposits', category: 'DeFi' });
      const rid = createReport(db);
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO report_instances (report_id, query_id, position, label, config, created_at) VALUES (?,?,?,?,?,?)'
      ).run(rid, qid, 0, 'ETH Deposits', JSON.stringify({ groupBy: 'day' }), now);

      const res = await request(app).get(`/api/reports/${rid}`);
      expect(res.status).toBe(200);
      expect(res.body.instances).toHaveLength(1);
      const inst = res.body.instances[0];
      expect(inst.label).toBe('ETH Deposits');
      expect(inst.config).toEqual({ groupBy: 'day' });
      expect(inst.query).toBeDefined();
      expect(inst.query.name).toBe('Deposits');
      expect(inst.query.category).toBe('DeFi');
      db.close();
    });

    test('instances returned in position order', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const now = new Date().toISOString();
      const stmt = db.prepare(
        'INSERT INTO report_instances (report_id, query_id, position, label, config, created_at) VALUES (?,?,?,?,?,?)'
      );
      stmt.run(rid, qid, 2, 'Third', '{}', now);
      stmt.run(rid, qid, 0, 'First', '{}', now);
      stmt.run(rid, qid, 1, 'Second', '{}', now);

      const res = await request(app).get(`/api/reports/${rid}`);
      expect(res.status).toBe(200);
      expect(res.body.instances.map(i => i.label)).toEqual(['First', 'Second', 'Third']);
      db.close();
    });
  });

  // ── PUT /api/reports/:id ───────────────────────────────────────────────────

  describe('PUT /api/reports/:id', () => {
    test('updates name and description', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = createReport(db, { name: 'Old Name' });
      const res = await request(app).put(`/api/reports/${id}`).send({ name: 'New Name', description: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.description).toBe('Updated');
      db.close();
    });

    test('not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/reports/9999').send({ name: 'X' });
      expect(res.status).toBe(404);
      db.close();
    });

    test('partial update preserves existing fields', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = createReport(db, { name: 'Original', description: 'Keep me' });
      const res = await request(app).put(`/api/reports/${id}`).send({ name: 'Changed' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Keep me');
      db.close();
    });
  });

  // ── DELETE /api/reports/:id ────────────────────────────────────────────────

  describe('DELETE /api/reports/:id', () => {
    test('deletes a report → 204', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = createReport(db);
      const del = await request(app).delete(`/api/reports/${id}`);
      expect(del.status).toBe(204);
      const get = await request(app).get(`/api/reports/${id}`);
      expect(get.status).toBe(404);
      db.close();
    });

    test('not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).delete('/api/reports/9999');
      expect(res.status).toBe(404);
      db.close();
    });

    test('deletes report and cascades to instances', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO report_instances (report_id, query_id, position, label, config, created_at) VALUES (?,?,?,?,?,?)'
      ).run(rid, qid, 0, 'inst', '{}', now);

      expect(db.prepare('SELECT COUNT(*) as n FROM report_instances WHERE report_id=?').get(rid).n).toBe(1);
      await request(app).delete(`/api/reports/${rid}`);
      expect(db.prepare('SELECT COUNT(*) as n FROM report_instances WHERE report_id=?').get(rid).n).toBe(0);
      db.close();
    });
  });

  // ── POST /api/reports/:id/instances ───────────────────────────────────────

  describe('POST /api/reports/:id/instances', () => {
    test('adds an instance to a report', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const res = await request(app)
        .post(`/api/reports/${rid}/instances`)
        .send({ query_id: qid, label: 'My Chart', config: { groupBy: 'week' } });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe('My Chart');
      expect(res.body.config).toEqual({ groupBy: 'week' });
      expect(res.body.query_id).toBe(qid);
      db.close();
    });

    test('config defaults to {} when omitted', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const res = await request(app)
        .post(`/api/reports/${rid}/instances`)
        .send({ query_id: qid });
      expect(res.status).toBe(201);
      expect(res.body.config).toEqual({});
      db.close();
    });

    test('auto-increments position when not specified', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const r1 = await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid });
      const r2 = await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid });
      expect(r1.body.position).toBe(0);
      expect(r2.body.position).toBe(1);
      db.close();
    });

    test('missing query_id → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const rid = createReport(db);
      const res = await request(app).post(`/api/reports/${rid}/instances`).send({ label: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    test('non-existent query_id → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const rid = createReport(db);
      const res = await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: 9999 });
      expect(res.status).toBe(400);
      db.close();
    });

    test('non-existent report → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const res = await request(app).post('/api/reports/9999/instances').send({ query_id: qid });
      expect(res.status).toBe(404);
      db.close();
    });
  });

  // ── PUT /api/reports/:id/instances/:iid ───────────────────────────────────

  describe('PUT /api/reports/:id/instances/:iid', () => {
    test('updates label and config', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const createRes = await request(app)
        .post(`/api/reports/${rid}/instances`)
        .send({ query_id: qid, label: 'Original' });
      const iid = createRes.body.id;

      const res = await request(app)
        .put(`/api/reports/${rid}/instances/${iid}`)
        .send({ label: 'Updated', config: { groupBy: 'month' } });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Updated');
      expect(res.body.config).toEqual({ groupBy: 'month' });
      db.close();
    });

    test('not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const rid = createReport(db);
      const res = await request(app).put(`/api/reports/${rid}/instances/9999`).send({ label: 'x' });
      expect(res.status).toBe(404);
      db.close();
    });

    test('instance from different report → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid1 = createReport(db, { name: 'Report A' });
      const rid2 = createReport(db, { name: 'Report B' });
      const createRes = await request(app)
        .post(`/api/reports/${rid1}/instances`)
        .send({ query_id: qid });
      const iid = createRes.body.id;
      // Try to update instance from rid1 as if it belongs to rid2
      const res = await request(app).put(`/api/reports/${rid2}/instances/${iid}`).send({ label: 'x' });
      expect(res.status).toBe(404);
      db.close();
    });
  });

  // ── DELETE /api/reports/:id/instances/:iid ────────────────────────────────

  describe('DELETE /api/reports/:id/instances/:iid', () => {
    test('deletes an instance → 204', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const createRes = await request(app)
        .post(`/api/reports/${rid}/instances`)
        .send({ query_id: qid });
      const iid = createRes.body.id;

      const del = await request(app).delete(`/api/reports/${rid}/instances/${iid}`);
      expect(del.status).toBe(204);

      const getRes = await request(app).get(`/api/reports/${rid}`);
      expect(getRes.body.instances).toHaveLength(0);
      db.close();
    });

    test('not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const rid = createReport(db);
      const res = await request(app).delete(`/api/reports/${rid}/instances/9999`);
      expect(res.status).toBe(404);
      db.close();
    });
  });

  // ── PUT /api/reports/:id/instances (bulk save) ────────────────────────────

  describe('PUT /api/reports/:id/instances (bulk save)', () => {
    test('replaces all instances atomically', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);

      // Seed two instances
      await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid, label: 'A' });
      await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid, label: 'B' });

      // Bulk-save one new instance (replaces both)
      const res = await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [{ query_id: qid, label: 'C', config: { groupBy: 'week' }, position: 0 }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].label).toBe('C');
      expect(res.body[0].config).toEqual({ groupBy: 'week' });
      db.close();
    });

    test('bulk-save with empty array clears all instances', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid });

      const res = await request(app).put(`/api/reports/${rid}/instances`).send({ instances: [] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });

    test('invalid query_id in payload → 400 (does not partially save)', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      // Pre-seed one good instance
      await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid, label: 'Before' });

      // Bulk-save mixes valid + invalid query_id
      const res = await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [
          { query_id: qid, label: 'Good' },
          { query_id: 9999, label: 'Bad' },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');

      // Existing instances must still be intact (no partial mutation)
      const check = await request(app).get(`/api/reports/${rid}`);
      expect(check.body.instances).toHaveLength(1);
      expect(check.body.instances[0].label).toBe('Before');
      db.close();
    });

    test('missing query_id in payload → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const rid = createReport(db);
      const res = await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [{ label: 'No query_id' }],
      });
      expect(res.status).toBe(400);
      db.close();
    });

    test('report not found → 404', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/reports/9999/instances').send({ instances: [] });
      expect(res.status).toBe(404);
      db.close();
    });

    test('config is stored as parsed JSON and returned as object', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      const config = { xField: 'timestamp', leftFields: ['amount'], groupBy: 'day', leftScaleY: true };

      await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [{ query_id: qid, label: 'Test', config }],
      });

      const get = await request(app).get(`/api/reports/${rid}`);
      expect(get.body.instances[0].config).toEqual(config);
      db.close();
    });

    test('updates the report updated_at timestamp', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);

      const before = db.prepare('SELECT updated_at FROM reports WHERE id=?').get(rid).updated_at;
      await new Promise(r => setTimeout(r, 10));

      await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [{ query_id: qid, label: 'x' }],
      });

      const after = db.prepare('SELECT updated_at FROM reports WHERE id=?').get(rid).updated_at;
      expect(after).not.toBe(before);
      db.close();
    });
  });

  // ── Multiple instances per query ───────────────────────────────────────────

  describe('Multiple instances of the same query', () => {
    test('allows the same query to appear multiple times', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);

      const res = await request(app).put(`/api/reports/${rid}/instances`).send({
        instances: [
          { query_id: qid, label: 'ETH', config: { xField: 'timestamp' } },
          { query_id: qid, label: 'BTC', config: { xField: 'timestamp' } },
          { query_id: qid, label: 'SOL', config: { xField: 'blockNumber' } },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map(i => i.label)).toEqual(['ETH', 'BTC', 'SOL']);
      db.close();
    });
  });

  // ── Query DELETE with report_instances reference ───────────────────────────

  describe('DELETE /api/queries/:id with report_instances reference', () => {
    test('returns 409 when query is used by a report instance', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const rid = createReport(db);
      // Add instance referencing the query
      await request(app).post(`/api/reports/${rid}/instances`).send({ query_id: qid });

      const res = await request(app).delete(`/api/queries/${qid}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('constraint_error');
      // Query should still exist
      const get = await request(app).get(`/api/queries/${qid}`);
      expect(get.status).toBe(200);
      db.close();
    });

    test('deletes freely when no report_instances reference it', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const qid = createQuery(db);
      const res = await request(app).delete(`/api/queries/${qid}`);
      expect(res.status).toBe(204);
      db.close();
    });
  });

} else {
  describe('reports.test.js — DB integration', () => {
    test.skip('all tests skipped: better-sqlite3 native module unavailable', () => {});
  });
}
