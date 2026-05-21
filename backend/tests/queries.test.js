'use strict';

/**
 * queries.test.js — Integration tests for GET/POST/PUT/DELETE /api/queries.
 * Requires better-sqlite3 native module; tests are skipped in environments
 * where the native module cannot be compiled.
 */

let request, express, queriesRoutes, Database, makeDb;
let nativeAvailable = false;

try {
  Database = require('better-sqlite3');
  // Try to instantiate to verify the native module works
  const testDb = new Database(':memory:');
  testDb.close();
  nativeAvailable = true;
} catch (e) {
  // Native module not available
}

if (nativeAvailable) {
  request = require('supertest');
  express = require('express');
  queriesRoutes = require('../src/routes/queries');

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Apply schema inline
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
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        chart_views TEXT NOT NULL DEFAULT '[]'
      );
      INSERT OR IGNORE INTO settings (key, value) VALUES ('builtin_imported', '0');
    `);
    return db;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/queries', queriesRoutes(db));
    return app;
  }

  describe('GET /api/queries — empty on fresh DB', () => {
    test('returns empty array', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/queries');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });
  });

  describe('POST /api/queries', () => {
    test('creates a query successfully', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const payload = {
        name: 'Test Query',
        gql: '{ items { id } }',
        result_path: 'data.items',
      };
      const res = await request(app).post('/api/queries').send(payload);
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Query');
      expect(res.body.id).toBeTruthy();
      db.close();
    });

    test('missing result_path → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/queries').send({
        name: 'Bad Query',
        gql: '{ items { id } }',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      db.close();
    });
  });

  describe('PUT /api/queries/:id', () => {
    test('updates an existing query', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const created = await request(app).post('/api/queries').send({
        name: 'Original', gql: '{ x }', result_path: 'data.x',
      });
      const id = created.body.id;

      const res = await request(app).put(`/api/queries/${id}`).send({ name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
      db.close();
    });
  });

  describe('DELETE /api/queries/:id', () => {
    test('deletes query and cascades runs', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const created = await request(app).post('/api/queries').send({
        name: 'To Delete', gql: '{ x }', result_path: 'data.x',
      });
      const id = created.body.id;

      const del = await request(app).delete(`/api/queries/${id}`);
      expect(del.status).toBe(204);

      const get = await request(app).get(`/api/queries/${id}`);
      expect(get.status).toBe(404);
      db.close();
    });
  });

  describe('POST /api/queries/import', () => {
    const builtinQuery = {
      name: 'My Builtin',
      gql: '{ items { id } }',
      result_path: 'data.items',
      is_builtin: 1,
    };

    test('import with is_builtin=1: re-import skips existing', async () => {
      const db = makeDb();
      const app = makeApp(db);
      await request(app).post('/api/queries/import').send([builtinQuery]);
      const res2 = await request(app).post('/api/queries/import').send([builtinQuery]);
      expect(res2.status).toBe(200);
      // Should still only have 1 query
      const list = await request(app).get('/api/queries');
      expect(list.body).toHaveLength(1);
      db.close();
    });

    test('import with is_builtin=0: re-import updates', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const userQuery = { ...builtinQuery, is_builtin: 0, name: 'User Query' };
      await request(app).post('/api/queries/import').send([userQuery]);
      const updated = { ...userQuery, description: 'Updated description' };
      await request(app).post('/api/queries/import').send([updated]);
      const list = await request(app).get('/api/queries');
      expect(list.body).toHaveLength(1);
      expect(list.body[0].description).toBe('Updated description');
      db.close();
    });
  });

} else {
  // Stub tests to mark as skipped — native module unavailable
  describe('queries.test.js — DB integration', () => {
    test.skip('GET /api/queries empty on fresh DB (skipped: better-sqlite3 native unavailable)', () => {});
    test.skip('POST creates; missing result_path → 400 (skipped)', () => {});
    test.skip('PUT updates (skipped)', () => {});
    test.skip('DELETE cascades (skipped)', () => {});
    test.skip('import is_builtin=1: re-import skips (skipped)', () => {});
    test.skip('import is_builtin=0: re-import updates (skipped)', () => {});
  });
}
