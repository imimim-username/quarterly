'use strict';

/**
 * settings.test.js — Integration tests for GET/PUT /api/settings and ping.
 * Requires better-sqlite3 native module; tests are skipped in environments
 * where the native module cannot be compiled.
 */

let request, express, settingsRoutes, Database;
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
  settingsRoutes = require('../src/routes/settings');

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
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    // Insert defaults
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
    const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of defaults) stmt.run(k, v);
    return db;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRoutes(db));
    return app;
  }

  describe('GET /api/settings', () => {
    test('returns defaults', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(200);
      expect(res.body.page_size).toBe('1000');
      expect(res.body.max_bytes).toBe('10485760');
      expect(res.body.endpoint).toBe('');
      db.close();
    });
  });

  describe('PUT /api/settings', () => {
    test('valid key updates setting', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/settings').send({ page_size: '500' });
      expect(res.status).toBe(200);
      expect(res.body.page_size).toBe('500');
      db.close();
    });

    test('unknown key → 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/settings').send({ unknown_key: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      db.close();
    });
  });

  describe('GET /api/settings/ping', () => {
    test('valid mock endpoint → ok: true', async () => {
      const db = makeDb();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('endpoint', ?)").run('http://127.0.0.1:9997/graphql');
      const app = makeApp(db);

      global.fetch.mockResolvedValueOnce(mockResponse({ data: { __typename: 'Query' } }));

      const res = await request(app).get('/api/settings/ping');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.latency_ms).toBeDefined();
      db.close();
    });

    test('blocked endpoint → ok: false', async () => {
      const db = makeDb();
      // Set a private HTTPS endpoint which validateUrl will reject
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('endpoint', ?)").run('https://10.0.0.1/graphql');
      const app = makeApp(db);

      const res = await request(app).get('/api/settings/ping');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeDefined();
      db.close();
    });
  });

} else {
  describe('settings.test.js — DB integration', () => {
    test.skip('GET returns defaults (skipped: better-sqlite3 native unavailable)', () => {});
    test.skip('PUT valid key updates (skipped)', () => {});
    test.skip('PUT unknown key → 400 (skipped)', () => {});
    test.skip('ping with valid mock endpoint → ok: true (skipped)', () => {});
    test.skip('ping with blocked endpoint → ok: false (skipped)', () => {});
  });
}
