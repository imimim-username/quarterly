'use strict';

/**
 * colorSchemes.test.js — Integration tests for /api/color-schemes endpoints.
 * Requires better-sqlite3 native module; tests are skipped in environments
 * where the native module cannot be compiled.
 */

let request, express, colorSchemesRoutes, Database;
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
  colorSchemesRoutes = require('../src/routes/colorSchemes');

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS color_schemes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        colors TEXT NOT NULL DEFAULT '[]',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return db;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/color-schemes', colorSchemesRoutes(db));
    return app;
  }

  /** Insert a scheme directly and return its id. */
  function seedScheme(db, name, colors = ['#ff0000', '#00ff00'], isDefault = 0) {
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO color_schemes (name, colors, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(name, JSON.stringify(colors), isDefault, now, now);
    return result.lastInsertRowid;
  }

  // ── GET / ────────────────────────────────────────────────────────────────────

  describe('GET /api/color-schemes', () => {
    test('returns empty array when no schemes exist', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/color-schemes');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });

    test('returns all schemes ordered by id, colors as array, is_default as boolean', async () => {
      const db = makeDb();
      const app = makeApp(db);
      seedScheme(db, 'Default', ['#111111', '#222222'], 1);
      seedScheme(db, 'Warm', ['#ff0000', '#ff8800'], 0);

      const res = await request(app).get('/api/color-schemes');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const def = res.body.find(s => s.name === 'Default');
      const warm = res.body.find(s => s.name === 'Warm');

      expect(def).toBeDefined();
      expect(Array.isArray(def.colors)).toBe(true);
      expect(def.colors).toEqual(['#111111', '#222222']);
      expect(typeof def.is_default).toBe('boolean');
      expect(def.is_default).toBe(true);

      expect(warm).toBeDefined();
      expect(warm.is_default).toBe(false);
      db.close();
    });
  });

  // ── GET /:id ─────────────────────────────────────────────────────────────────

  describe('GET /api/color-schemes/:id', () => {
    test('returns a single scheme by id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Solo', ['#abcdef'], 1);

      const res = await request(app).get(`/api/color-schemes/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Solo');
      expect(res.body.colors).toEqual(['#abcdef']);
      expect(res.body.is_default).toBe(true);
      db.close();
    });

    test('returns 404 for non-existent id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/color-schemes/9999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────────

  describe('POST /api/color-schemes', () => {
    test('creates a new scheme and returns it', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'Ocean',
        colors: ['#0099cc', '#005577'],
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.name).toBe('Ocean');
      expect(res.body.colors).toEqual(['#0099cc', '#005577']);
      expect(res.body.is_default).toBe(false);
      db.close();
    });

    test('rejects missing name with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        colors: ['#ff0000'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects blank name with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: '   ',
        colors: ['#ff0000'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects missing colors with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'NoColors',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects empty colors array with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'Empty',
        colors: [],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('returns 409 for duplicate name', async () => {
      const db = makeDb();
      const app = makeApp(db);
      await request(app).post('/api/color-schemes').send({
        name: 'Duplicate',
        colors: ['#aaaaaa'],
      });
      const res = await request(app).post('/api/color-schemes').send({
        name: 'Duplicate',
        colors: ['#bbbbbb'],
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('conflict');
      db.close();
    });
  });

  // ── PUT /:id ─────────────────────────────────────────────────────────────────

  describe('PUT /api/color-schemes/:id', () => {
    test('updates name and colors', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Original', ['#000000']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        name: 'Updated',
        colors: ['#ffffff', '#888888'],
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
      expect(res.body.colors).toEqual(['#ffffff', '#888888']);
      db.close();
    });

    test('partial update — omitting name keeps existing name', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Keep', ['#000000']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        colors: ['#ffffff'],
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Keep');
      expect(res.body.colors).toEqual(['#ffffff']);
      db.close();
    });

    test('partial update — omitting colors keeps existing colors', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'KeepColors', ['#123456', '#654321']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        name: 'RenamedOnly',
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('RenamedOnly');
      expect(res.body.colors).toEqual(['#123456', '#654321']);
      db.close();
    });

    test('returns 404 for non-existent id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/color-schemes/9999').send({
        name: 'Ghost',
        colors: ['#ff0000'],
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });

    test('returns 409 when renaming to an already-taken name', async () => {
      const db = makeDb();
      const app = makeApp(db);
      seedScheme(db, 'Taken', ['#aaaaaa']);
      const id = seedScheme(db, 'Mover', ['#bbbbbb']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        name: 'Taken',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('conflict');
      db.close();
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────────

  describe('DELETE /api/color-schemes/:id', () => {
    test('deletes a non-default scheme and returns 204', async () => {
      const db = makeDb();
      const app = makeApp(db);
      seedScheme(db, 'Default', ['#ffffff'], 1);
      const id = seedScheme(db, 'ToDelete', ['#000000'], 0);

      const del = await request(app).delete(`/api/color-schemes/${id}`);
      expect(del.status).toBe(204);

      const list = await request(app).get('/api/color-schemes');
      expect(list.body).toHaveLength(1);
      expect(list.body[0].name).toBe('Default');
      db.close();
    });

    test('returns 400 when trying to delete the default scheme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Default', ['#ffffff'], 1);
      seedScheme(db, 'Other', ['#000000'], 0);

      const res = await request(app).delete(`/api/color-schemes/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('cannot_delete_default');
      db.close();
    });

    test('returns 400 when trying to delete the only remaining scheme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      // Only one scheme, and it is NOT the default (to avoid hitting cannot_delete_default first)
      // In practice the last scheme guard is separate
      const id = seedScheme(db, 'OnlyOne', ['#ffffff'], 0);

      const res = await request(app).delete(`/api/color-schemes/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('last_scheme');
      db.close();
    });

    test('returns 404 for non-existent id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).delete('/api/color-schemes/9999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });
  });

  // ── POST /:id/set-default ────────────────────────────────────────────────────

  describe('POST /api/color-schemes/:id/set-default', () => {
    test('sets the target scheme as default and clears the previous one', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const defaultId = seedScheme(db, 'Old Default', ['#111111'], 1);
      const newId = seedScheme(db, 'New Default', ['#222222'], 0);

      const res = await request(app).post(`/api/color-schemes/${newId}/set-default`).send({});
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(newId);
      expect(res.body.is_default).toBe(true);

      const list = await request(app).get('/api/color-schemes');
      const old = list.body.find(s => s.id === defaultId);
      const updated = list.body.find(s => s.id === newId);
      expect(old.is_default).toBe(false);
      expect(updated.is_default).toBe(true);
      db.close();
    });

    test('setting already-default scheme as default is a no-op — still default', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Already Default', ['#ffffff'], 1);

      const res = await request(app).post(`/api/color-schemes/${id}/set-default`).send({});
      expect(res.status).toBe(200);
      expect(res.body.is_default).toBe(true);
      db.close();
    });

    test('returns 404 for non-existent id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes/9999/set-default').send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });
  });

} else {
  describe('colorSchemes.test.js — DB integration', () => {
    test.skip('GET / returns empty array (skipped: better-sqlite3 native unavailable)', () => {});
    test.skip('GET / returns schemes with colors as array and is_default as boolean (skipped)', () => {});
    test.skip('GET /:id returns a single scheme (skipped)', () => {});
    test.skip('GET /:id returns 404 for missing id (skipped)', () => {});
    test.skip('POST / creates a scheme (skipped)', () => {});
    test.skip('POST / rejects missing name (skipped)', () => {});
    test.skip('POST / rejects blank name (skipped)', () => {});
    test.skip('POST / rejects missing colors (skipped)', () => {});
    test.skip('POST / rejects empty colors (skipped)', () => {});
    test.skip('POST / returns 409 for duplicate name (skipped)', () => {});
    test.skip('PUT /:id updates name and colors (skipped)', () => {});
    test.skip('PUT /:id partial update keeps existing name (skipped)', () => {});
    test.skip('PUT /:id partial update keeps existing colors (skipped)', () => {});
    test.skip('PUT /:id returns 404 for missing id (skipped)', () => {});
    test.skip('PUT /:id returns 409 for name conflict (skipped)', () => {});
    test.skip('DELETE /:id removes non-default scheme (skipped)', () => {});
    test.skip('DELETE /:id returns 400 for default scheme (skipped)', () => {});
    test.skip('DELETE /:id returns 400 for last scheme (skipped)', () => {});
    test.skip('DELETE /:id returns 404 for missing id (skipped)', () => {});
    test.skip('POST /:id/set-default sets new default and clears old (skipped)', () => {});
    test.skip('POST /:id/set-default idempotent on already-default (skipped)', () => {});
    test.skip('POST /:id/set-default returns 404 for missing id (skipped)', () => {});
  });
}
