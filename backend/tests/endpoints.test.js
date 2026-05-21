'use strict';

/**
 * endpoints.test.js — Integration tests for GET/POST/PUT/DELETE /api/endpoints.
 * Requires better-sqlite3 native module; tests are skipped in environments
 * where the native module cannot be compiled.
 */

let request, express, endpointsRoutes, Database;
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
  endpointsRoutes = require('../src/routes/endpoints');

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        headers TEXT NOT NULL DEFAULT '{}',
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
    app.use('/api/endpoints', endpointsRoutes(db));
    return app;
  }

  describe('GET /api/endpoints', () => {
    test('returns empty array when no profiles exist', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/endpoints');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });
  });

  describe('POST /api/endpoints', () => {
    test('creates a profile with name required', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/endpoints').send({
        name: 'Production',
        url: 'https://example.com/graphql',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.name).toBe('Production');
      expect(res.body.url).toBe('https://example.com/graphql');
      expect(res.body.headers).toEqual({ Authorization: 'Bearer token' });
      expect(res.body.is_default).toBe(false);
      db.close();
    });

    test('validates name is required', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/endpoints').send({
        url: 'https://example.com/graphql',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    test('validates headers must be a plain object', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/endpoints').send({
        name: 'Test',
        headers: ['not', 'an', 'object'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    test('is_default:true sets is_default and clears existing default', async () => {
      const db = makeDb();
      const app = makeApp(db);

      // Create first profile as default
      const first = await request(app).post('/api/endpoints').send({
        name: 'First',
        is_default: true,
      });
      expect(first.status).toBe(201);
      expect(first.body.is_default).toBe(true);

      // Create second profile as default — should clear first
      const second = await request(app).post('/api/endpoints').send({
        name: 'Second',
        is_default: true,
      });
      expect(second.status).toBe(201);
      expect(second.body.is_default).toBe(true);

      // Verify first is no longer default
      const list = await request(app).get('/api/endpoints');
      expect(list.status).toBe(200);
      const firstEntry = list.body.find(e => e.id === first.body.id);
      const secondEntry = list.body.find(e => e.id === second.body.id);
      expect(firstEntry.is_default).toBe(false);
      expect(secondEntry.is_default).toBe(true);
      db.close();
    });
  });

  describe('GET /api/endpoints — after inserts', () => {
    test('returns created profiles, parses headers JSON, converts is_default to boolean', async () => {
      const db = makeDb();
      const app = makeApp(db);

      await request(app).post('/api/endpoints').send({
        name: 'Alpha',
        url: 'https://alpha.example.com',
        headers: { 'X-Api-Key': 'abc' },
        is_default: true,
      });
      await request(app).post('/api/endpoints').send({
        name: 'Beta',
        url: 'https://beta.example.com',
      });

      const res = await request(app).get('/api/endpoints');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const alpha = res.body.find(e => e.name === 'Alpha');
      const beta = res.body.find(e => e.name === 'Beta');

      expect(alpha).toBeDefined();
      expect(alpha.headers).toEqual({ 'X-Api-Key': 'abc' });
      expect(typeof alpha.is_default).toBe('boolean');
      expect(alpha.is_default).toBe(true);

      expect(beta).toBeDefined();
      expect(beta.headers).toEqual({});
      expect(beta.is_default).toBe(false);
      db.close();
    });
  });

  describe('PUT /api/endpoints/:id', () => {
    test('updates name/url/headers/is_default', async () => {
      const db = makeDb();
      const app = makeApp(db);

      const created = await request(app).post('/api/endpoints').send({
        name: 'Original',
        url: 'https://orig.example.com',
        headers: {},
      });
      expect(created.status).toBe(201);
      const id = created.body.id;

      const updated = await request(app).put(`/api/endpoints/${id}`).send({
        name: 'Updated',
        url: 'https://updated.example.com',
        headers: { 'X-New': 'header' },
        is_default: false,
      });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Updated');
      expect(updated.body.url).toBe('https://updated.example.com');
      expect(updated.body.headers).toEqual({ 'X-New': 'header' });
      expect(updated.body.is_default).toBe(false);
      db.close();
    });

    test('setting is_default:true clears other defaults', async () => {
      const db = makeDb();
      const app = makeApp(db);

      const first = await request(app).post('/api/endpoints').send({
        name: 'First',
        is_default: true,
      });
      expect(first.body.is_default).toBe(true);

      const second = await request(app).post('/api/endpoints').send({
        name: 'Second',
      });
      expect(second.body.is_default).toBe(false);

      // PUT second to set it as default
      const putRes = await request(app).put(`/api/endpoints/${second.body.id}`).send({
        name: 'Second',
        is_default: true,
      });
      expect(putRes.status).toBe(200);
      expect(putRes.body.is_default).toBe(true);

      // First should no longer be default
      const list = await request(app).get('/api/endpoints');
      const firstEntry = list.body.find(e => e.id === first.body.id);
      expect(firstEntry.is_default).toBe(false);
      db.close();
    });

    test('returns 404 for non-existent id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/endpoints/999').send({ name: 'Ghost' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });
  });

  describe('DELETE /api/endpoints/:id', () => {
    test('removes the profile; 404 on second delete', async () => {
      const db = makeDb();
      const app = makeApp(db);

      const created = await request(app).post('/api/endpoints').send({ name: 'ToDelete' });
      expect(created.status).toBe(201);
      const id = created.body.id;

      const del1 = await request(app).delete(`/api/endpoints/${id}`);
      expect(del1.status).toBe(204);

      const del2 = await request(app).delete(`/api/endpoints/${id}`);
      expect(del2.status).toBe(404);
      expect(del2.body.error).toBe('not_found');
      db.close();
    });
  });

  describe('POST /api/endpoints — missing name', () => {
    test('missing name → 400 validation error', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/endpoints').send({
        url: 'https://example.com',
        headers: {},
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      expect(res.body.message).toMatch(/name/i);
      db.close();
    });
  });

} else {
  describe('endpoints.test.js — DB integration', () => {
    test.skip('GET / returns empty array (skipped: better-sqlite3 native unavailable)', () => {});
    test.skip('POST / creates a profile (skipped)', () => {});
    test.skip('POST / validates name required (skipped)', () => {});
    test.skip('POST / validates headers must be plain object (skipped)', () => {});
    test.skip('POST / with is_default:true clears existing default (skipped)', () => {});
    test.skip('GET / returns created profiles, parses headers, converts is_default (skipped)', () => {});
    test.skip('PUT /:id updates name/url/headers/is_default (skipped)', () => {});
    test.skip('PUT /:id setting is_default:true clears other defaults (skipped)', () => {});
    test.skip('DELETE /:id removes profile; 404 on second delete (skipped)', () => {});
    test.skip('PUT /999 → 404 for non-existent id (skipped)', () => {});
    test.skip('POST / with missing name → 400 validation error (skipped)', () => {});
  });
}
