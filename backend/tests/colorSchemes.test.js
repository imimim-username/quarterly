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
        theme TEXT DEFAULT NULL,
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
  function seedScheme(db, name, colors = ['#ff0000', '#00ff00'], isDefault = 0, theme = null) {
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO color_schemes (name, colors, theme, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(name, JSON.stringify(colors), theme ? JSON.stringify(theme) : null, isDefault, now, now);
    return result.lastInsertRowid;
  }

  const VALID_THEME = { bg: '#1a1a2e', textColor: '#c0c0c0', gridColor: '#3a3a5a', axisColor: '#5a5a8a' };

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

    test('scheme without theme returns theme: null', async () => {
      const db = makeDb();
      const app = makeApp(db);
      seedScheme(db, 'NoTheme', ['#ff0000']);

      const res = await request(app).get('/api/color-schemes');
      expect(res.status).toBe(200);
      expect(res.body[0].theme).toBeNull();
      db.close();
    });

    test('scheme with theme returns theme object', async () => {
      const db = makeDb();
      const app = makeApp(db);
      seedScheme(db, 'Themed', ['#ff0000'], 0, VALID_THEME);

      const res = await request(app).get('/api/color-schemes');
      expect(res.status).toBe(200);
      expect(res.body[0].theme).toEqual(VALID_THEME);
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

    test('returns theme: null for scheme without theme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Plain', ['#ff0000']);

      const res = await request(app).get(`/api/color-schemes/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.theme).toBeNull();
      db.close();
    });

    test('returns theme object for scheme with theme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Themed', ['#ff0000'], 0, VALID_THEME);

      const res = await request(app).get(`/api/color-schemes/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.theme).toEqual(VALID_THEME);
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

    test('rejects name longer than 255 chars with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'a'.repeat(256),
        colors: ['#ff0000'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects colors array with more than 100 entries with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'TooMany',
        colors: Array.from({ length: 101 }, () => '#ff0000'),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects invalid (non-hex) color values with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'BadColor',
        colors: ['#ff0000', 'red', 'rgb(0,0,0)'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('accepts 3-char shorthand hex colors (#rgb)', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'ShortHex',
        colors: ['#f00', '#0f0', '#00f'],
      });
      expect(res.status).toBe(201);
      expect(res.body.colors).toEqual(['#f00', '#0f0', '#00f']);
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

    // Theme field — POST

    test('POST without theme returns theme: null', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'NoTheme',
        colors: ['#ff0000'],
      });
      expect(res.status).toBe(201);
      expect(res.body.theme).toBeNull();
      db.close();
    });

    test('POST with theme: null returns theme: null', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'NullTheme',
        colors: ['#ff0000'],
        theme: null,
      });
      expect(res.status).toBe(201);
      expect(res.body.theme).toBeNull();
      db.close();
    });

    test('POST with valid full theme stores and returns it', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'Themed',
        colors: ['#ff0000'],
        theme: VALID_THEME,
      });
      expect(res.status).toBe(201);
      expect(res.body.theme).toEqual(VALID_THEME);
      db.close();
    });

    test('POST with partial theme (subset of keys) is valid', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const partial = { bg: '#000000', textColor: '#ffffff' };
      const res = await request(app).post('/api/color-schemes').send({
        name: 'Partial',
        colors: ['#ff0000'],
        theme: partial,
      });
      expect(res.status).toBe(201);
      expect(res.body.theme).toEqual(partial);
      db.close();
    });

    test('POST with theme as an array returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'ArrayTheme',
        colors: ['#ff0000'],
        theme: ['#000000'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('POST with theme as a string returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'StringTheme',
        colors: ['#ff0000'],
        theme: '#000000',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('POST with unknown theme key returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'BadKey',
        colors: ['#ff0000'],
        theme: { bg: '#000000', unknownKey: '#ffffff' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      expect(res.body.message).toMatch('unknownKey');
      db.close();
    });

    test('POST with invalid hex value in theme returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'BadHexTheme',
        colors: ['#ff0000'],
        theme: { bg: 'not-a-color' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('POST with theme value null (clearing a single key) is valid', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/color-schemes').send({
        name: 'NullBg',
        colors: ['#ff0000'],
        theme: { bg: null, textColor: '#ffffff' },
      });
      expect(res.status).toBe(201);
      expect(res.body.theme).toEqual({ bg: null, textColor: '#ffffff' });
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

    test('rejects invalid hex color values in PUT with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'ValidScheme', ['#aabbcc']);
      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        colors: ['not-a-color'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('rejects name > 255 chars in PUT with 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Short', ['#aabbcc']);
      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        name: 'x'.repeat(256),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
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

    // Theme field — PUT

    test('PUT with valid theme updates theme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Plain', ['#ff0000']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        theme: VALID_THEME,
      });
      expect(res.status).toBe(200);
      expect(res.body.theme).toEqual(VALID_THEME);
      db.close();
    });

    test('PUT with theme: null clears existing theme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Themed', ['#ff0000'], 0, VALID_THEME);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        theme: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.theme).toBeNull();
      db.close();
    });

    test('PUT omitting theme preserves existing theme', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'HasTheme', ['#ff0000'], 0, VALID_THEME);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        name: 'HasThemeRenamed',
      });
      expect(res.status).toBe(200);
      expect(res.body.theme).toEqual(VALID_THEME);
      db.close();
    });

    test('PUT with unknown theme key returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Scheme', ['#ff0000']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        theme: { bg: '#000000', bogus: '#ffffff' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
      db.close();
    });

    test('PUT with non-hex theme value returns 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const id = seedScheme(db, 'Scheme2', ['#ff0000']);

      const res = await request(app).put(`/api/color-schemes/${id}`).send({
        theme: { bg: 'blue' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid');
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
    const skipped = [
      'GET / returns empty array',
      'GET / returns schemes with colors as array and is_default as boolean',
      'GET / scheme without theme returns theme: null',
      'GET / scheme with theme returns theme object',
      'GET /:id returns a single scheme',
      'GET /:id returns 404 for missing id',
      'GET /:id returns theme: null for scheme without theme',
      'GET /:id returns theme object for scheme with theme',
      'POST / creates a scheme',
      'POST / rejects missing name',
      'POST / rejects blank name',
      'POST / rejects name > 255 chars',
      'POST / rejects missing colors',
      'POST / rejects empty colors',
      'POST / rejects colors array > 100 entries',
      'POST / rejects non-hex color values',
      'POST / accepts #rgb shorthand hex',
      'POST / returns 409 for duplicate name',
      'POST / without theme returns theme: null',
      'POST / with theme: null returns theme: null',
      'POST / with valid full theme stores and returns it',
      'POST / with partial theme is valid',
      'POST / with theme as array returns 400',
      'POST / with theme as string returns 400',
      'POST / with unknown theme key returns 400',
      'POST / with invalid hex in theme returns 400',
      'POST / with theme value null (single key) is valid',
      'PUT /:id updates name and colors',
      'PUT /:id partial update keeps existing name',
      'PUT /:id partial update keeps existing colors',
      'PUT /:id returns 404 for missing id',
      'PUT /:id rejects invalid hex in colors',
      'PUT /:id rejects name > 255 chars',
      'PUT /:id returns 409 for name conflict',
      'PUT /:id with valid theme updates theme',
      'PUT /:id with theme: null clears theme',
      'PUT /:id omitting theme preserves existing theme',
      'PUT /:id with unknown theme key returns 400',
      'PUT /:id with non-hex theme value returns 400',
      'DELETE /:id removes non-default scheme',
      'DELETE /:id returns 400 for default scheme',
      'DELETE /:id returns 400 for last scheme',
      'DELETE /:id returns 404 for missing id',
      'POST /:id/set-default sets new default and clears old',
      'POST /:id/set-default idempotent on already-default',
      'POST /:id/set-default returns 404 for missing id',
    ];
    skipped.forEach(name => {
      test.skip(`${name} (skipped: better-sqlite3 native unavailable)`, () => {});
    });
  });
}
