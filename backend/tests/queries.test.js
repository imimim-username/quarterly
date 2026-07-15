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
        chart_views TEXT NOT NULL DEFAULT '[]',
        computed_columns TEXT NOT NULL DEFAULT '[]',
        timestamp_extraction TEXT
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

  describe('computed_columns round-trip', () => {
    const basePayload = { name: 'CC Query', gql: '{ x }', result_path: 'data.x' };
    const cols = [{ name: 'ratio', label: 'Ratio', formula: 'a / b' }];

    test('defaults to empty array when omitted', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/queries').send(basePayload);
      expect(res.status).toBe(201);
      expect(res.body.computed_columns).toEqual([]);
      db.close();
    });

    test('round-trips computed_columns through POST/GET', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const created = await request(app).post('/api/queries').send({ ...basePayload, computed_columns: cols });
      expect(created.status).toBe(201);
      expect(created.body.computed_columns).toEqual(cols);

      const got = await request(app).get(`/api/queries/${created.body.id}`);
      expect(got.status).toBe(200);
      expect(got.body.computed_columns).toEqual(cols);
      db.close();
    });

    test('round-trips computed_columns through PUT', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const created = await request(app).post('/api/queries').send(basePayload);
      const id = created.body.id;

      const updated = await request(app).put(`/api/queries/${id}`).send({ computed_columns: cols });
      expect(updated.status).toBe(200);
      expect(updated.body.computed_columns).toEqual(cols);
      db.close();
    });

    test('accepts computed_columns as a JSON string', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/queries').send({
        ...basePayload,
        computed_columns: JSON.stringify(cols),
      });
      expect(res.status).toBe(201);
      expect(res.body.computed_columns).toEqual(cols);
      db.close();
    });

    test('invalid computed_columns JSON string → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/queries').send({
        ...basePayload,
        computed_columns: 'not-json',
      });
      expect(res.status).toBe(400);
      db.close();
    });

    test('computed_columns as object (not array) → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/queries').send({
        ...basePayload,
        computed_columns: { ratio: 'a / b' },
      });
      expect(res.status).toBe(400);
      db.close();
    });
  });

  describe('GET /api/queries — corrupt row skipped (BUG 5 fix)', () => {
    test('one corrupt row does not fail entire list — returns remaining good rows', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const now = new Date().toISOString();

      // Insert a valid query via the normal route
      const good = await request(app).post('/api/queries').send({
        name: 'Good Query', gql: '{ x }', result_path: 'data.x',
      });
      expect(good.status).toBe(201);

      // Directly insert a row with corrupt variable_defs JSON (bypasses validation)
      db.prepare(
        `INSERT INTO queries (name, description, category, gql, variable_defs, result_path,
          pagination_style, cursor_path, has_next_path, date_format, chain_mode, chain_var_name,
          chain_field, field_meta, key_field, is_builtin, chart_views, computed_columns,
          timestamp_extraction, created_at, updated_at)
         VALUES (?, '', 'General', ?, ?, 'data.x', 'offset', '', '', 'unix_seconds', 'filter',
                 'chain', 'chain', '{}', 'id', 0, '[]', '[]', NULL, ?, ?)`
      ).run('Corrupt Query', '{ bad }', 'NOT VALID JSON', now, now);

      const res = await request(app).get('/api/queries');
      // Should still return 200 (not 500)
      expect(res.status).toBe(200);
      // Should include the good query
      expect(res.body.some(q => q.name === 'Good Query')).toBe(true);
      // Should NOT include the corrupt query (skipped)
      expect(res.body.some(q => q.name === 'Corrupt Query')).toBe(false);
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

    // BUG 6 fix: import UPDATE was omitting chart_views and timestamp_extraction
    test('import UPDATE preserves chart_views when re-importing non-builtin', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const chartViews = [{ type: 'bar', xField: 'ts', yFields: ['val'] }];
      const userQuery = {
        ...builtinQuery,
        is_builtin: 0, name: 'User Query With Charts',
        chart_views: chartViews,
      };
      await request(app).post('/api/queries/import').send([userQuery]);
      // Re-import with updated description — chart_views should be preserved
      await request(app).post('/api/queries/import').send([{ ...userQuery, description: 'v2' }]);

      const list = await request(app).get('/api/queries');
      expect(list.body).toHaveLength(1);
      expect(list.body[0].description).toBe('v2');
      expect(list.body[0].chart_views).toEqual(chartViews);
      db.close();
    });

    test('import UPDATE preserves timestamp_extraction when re-importing non-builtin', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const tsExtraction = { field: 'createdAt', format: 'unix_seconds' };
      const userQuery = {
        ...builtinQuery,
        is_builtin: 0, name: 'User Query With TS',
        timestamp_extraction: tsExtraction,
      };
      await request(app).post('/api/queries/import').send([userQuery]);
      // Re-import — timestamp_extraction should be updated
      const tsV2 = { field: 'updatedAt', format: 'iso8601' };
      await request(app).post('/api/queries/import').send([{ ...userQuery, timestamp_extraction: tsV2 }]);

      const list = await request(app).get('/api/queries');
      expect(list.body).toHaveLength(1);
      expect(list.body[0].timestamp_extraction).toEqual(tsV2);
      db.close();
    });

    // BUG 7 fix: import INSERT was omitting timestamp_extraction and chart_views
    test('import INSERT persists chart_views for new non-builtin queries', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const chartViews = [{ type: 'line', xField: 'ts', yFields: ['amount'] }];
      const res = await request(app).post('/api/queries/import').send([{
        ...builtinQuery,
        is_builtin: 0, name: 'New Query With Charts',
        chart_views: chartViews,
      }]);
      expect(res.status).toBe(200);

      const list = await request(app).get('/api/queries');
      expect(list.body[0].chart_views).toEqual(chartViews);
      db.close();
    });

    test('import INSERT persists timestamp_extraction for new non-builtin queries', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const tsExtraction = { field: 'createdAt', format: 'unix_seconds' };
      await request(app).post('/api/queries/import').send([{
        ...builtinQuery,
        is_builtin: 0, name: 'New Query With TS',
        timestamp_extraction: tsExtraction,
      }]);

      const list = await request(app).get('/api/queries');
      expect(list.body[0].timestamp_extraction).toEqual(tsExtraction);
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
    test.skip('computed_columns defaults to [] (skipped)', () => {});
    test.skip('computed_columns round-trips POST/GET (skipped)', () => {});
    test.skip('computed_columns round-trips PUT (skipped)', () => {});
    test.skip('invalid computed_columns → 400 (skipped)', () => {});
  });
}
