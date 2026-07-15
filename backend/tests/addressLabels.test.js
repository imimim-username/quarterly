'use strict';

/**
 * addressLabels.test.js — Integration tests for /api/address-labels.
 */

let request, express, addressLabelsRoutes, Database;
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
  request             = require('supertest');
  express             = require('express');
  addressLabelsRoutes = require('../src/routes/addressLabels');

  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS address_labels (
        id          INTEGER PRIMARY KEY,
        address     TEXT NOT NULL,
        chain       TEXT NOT NULL DEFAULT '',
        name        TEXT NOT NULL,
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(address, chain)
      );
      CREATE INDEX IF NOT EXISTS idx_address_labels_address ON address_labels(address);
    `);
    return db;
  }

  function makeApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api/address-labels', addressLabelsRoutes(db));
    return app;
  }

  function seed(db, overrides = {}) {
    const now = new Date().toISOString();
    const info = db.prepare(
      'INSERT INTO address_labels (address, chain, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      overrides.address  ?? '0xabc',
      overrides.chain    ?? 'ethereum',
      overrides.name     ?? 'Alice',
      overrides.notes    ?? '',
      now,
      now,
    );
    return info.lastInsertRowid;
  }

  // ── GET /api/address-labels ─────────────────────────────────────────────────

  describe('GET /api/address-labels', () => {
    it('returns empty array on fresh DB', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/address-labels');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      db.close();
    });

    it('returns all labels ordered by chain then address', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      seed(db, { address: '0xbbb', chain: 'ethereum', name: 'Bob' });
      seed(db, { address: '0xaaa', chain: 'ethereum', name: 'Alice' });
      seed(db, { address: '0xccc', chain: 'arbitrum', name: 'Carol' });

      const res = await request(app).get('/api/address-labels');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // arbitrum sorts before ethereum
      expect(res.body[0].chain).toBe('arbitrum');
      // within ethereum: 0xaaa < 0xbbb
      expect(res.body[1].name).toBe('Alice');
      expect(res.body[2].name).toBe('Bob');
      db.close();
    });

    it('includes all expected fields', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      seed(db, { address: '0xabc', chain: 'ethereum', name: 'Alice', notes: 'whale' });
      const res = await request(app).get('/api/address-labels');
      const label = res.body[0];
      expect(label).toHaveProperty('id');
      expect(label).toHaveProperty('address');
      expect(label).toHaveProperty('chain');
      expect(label).toHaveProperty('name');
      expect(label).toHaveProperty('notes');
      expect(label).toHaveProperty('created_at');
      expect(label).toHaveProperty('updated_at');
      db.close();
    });
  });

  // ── GET /api/address-labels/:id ─────────────────────────────────────────────

  describe('GET /api/address-labels/:id', () => {
    it('returns the label by id', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db, { address: '0xdef', chain: 'base', name: 'Dave' });
      const res = await request(app).get(`/api/address-labels/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.address).toBe('0xdef');
      expect(res.body.chain).toBe('base');
      expect(res.body.name).toBe('Dave');
      db.close();
    });

    it('returns 404 for non-existent id', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/address-labels/9999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
      db.close();
    });
  });

  // ── POST /api/address-labels ────────────────────────────────────────────────

  describe('POST /api/address-labels', () => {
    it('creates a label with address and name', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({
        address: '0x1234',
        name:    'Treasury',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.address).toBe('0x1234');
      expect(res.body.name).toBe('Treasury');
      expect(res.body.chain).toBe('');   // default
      expect(res.body.notes).toBe('');   // default
      db.close();
    });

    it('creates a label with all optional fields', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({
        address: '0xabc',
        chain:   'optimism',
        name:    'Gnosis Safe',
        notes:   'Team multisig',
      });
      expect(res.status).toBe(201);
      expect(res.body.chain).toBe('optimism');
      expect(res.body.notes).toBe('Team multisig');
      db.close();
    });

    it('trims whitespace from address and name', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({
        address: '  0x1234  ',
        name:    '  Treasury  ',
      });
      expect(res.status).toBe(201);
      expect(res.body.address).toBe('0x1234');
      expect(res.body.name).toBe('Treasury');
      db.close();
    });

    it('missing address → 400', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({ name: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    it('blank address → 400', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({ address: '   ', name: 'X' });
      expect(res.status).toBe(400);
      db.close();
    });

    it('missing name → 400', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).post('/api/address-labels').send({ address: '0xabc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
      db.close();
    });

    it('duplicate (address, chain) → 409', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      await request(app).post('/api/address-labels').send({ address: '0xabc', chain: 'ethereum', name: 'First' });
      const res = await request(app).post('/api/address-labels').send({ address: '0xabc', chain: 'ethereum', name: 'Second' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('conflict');
      db.close();
    });

    it('same address on different chains is allowed', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const r1 = await request(app).post('/api/address-labels').send({ address: '0xabc', chain: 'ethereum', name: 'ETH' });
      const r2 = await request(app).post('/api/address-labels').send({ address: '0xabc', chain: 'arbitrum', name: 'ARB' });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      db.close();
    });
  });

  // ── PUT /api/address-labels/:id ─────────────────────────────────────────────

  describe('PUT /api/address-labels/:id', () => {
    it('updates name and notes', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db, { name: 'Old Name' });
      const res = await request(app).put(`/api/address-labels/${id}`).send({
        name:  'New Name',
        notes: 'Updated note',
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.notes).toBe('Updated note');
      db.close();
    });

    it('partial update preserves existing fields', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db, { address: '0xabc', chain: 'ethereum', name: 'Alice', notes: 'keep me' });
      const res = await request(app).put(`/api/address-labels/${id}`).send({ name: 'Alice Updated' });
      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('keep me');
      expect(res.body.address).toBe('0xabc');
      expect(res.body.chain).toBe('ethereum');
      db.close();
    });

    it('updates updated_at timestamp', async () => {
      const db   = makeDb();
      const app  = makeApp(db);
      const id   = seed(db);
      const before = db.prepare('SELECT updated_at FROM address_labels WHERE id=?').get(id).updated_at;
      await new Promise(r => setTimeout(r, 10));
      await request(app).put(`/api/address-labels/${id}`).send({ name: 'New' });
      const after = db.prepare('SELECT updated_at FROM address_labels WHERE id=?').get(id).updated_at;
      expect(after).not.toBe(before);
      db.close();
    });

    it('not found → 404', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).put('/api/address-labels/9999').send({ name: 'X' });
      expect(res.status).toBe(404);
      db.close();
    });

    it('update that creates a duplicate (address, chain) → 409', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      seed(db, { address: '0xaaa', chain: 'ethereum', name: 'First' });
      const id2 = seed(db, { address: '0xbbb', chain: 'ethereum', name: 'Second' });
      // Try to change 0xbbb → 0xaaa on same chain (collision with First)
      const res = await request(app).put(`/api/address-labels/${id2}`).send({ address: '0xaaa' });
      expect(res.status).toBe(409);
      db.close();
    });

    it('blank name in update → 400', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db);
      const res = await request(app).put(`/api/address-labels/${id}`).send({ name: '' });
      expect(res.status).toBe(400);
      db.close();
    });
  });

  // ── DELETE /api/address-labels/:id ──────────────────────────────────────────

  describe('DELETE /api/address-labels/:id', () => {
    it('deletes a label → 204', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db);
      const del = await request(app).delete(`/api/address-labels/${id}`);
      expect(del.status).toBe(204);
      const get = await request(app).get(`/api/address-labels/${id}`);
      expect(get.status).toBe(404);
      db.close();
    });

    it('not found → 404', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const res = await request(app).delete('/api/address-labels/9999');
      expect(res.status).toBe(404);
      db.close();
    });

    it('after deletion same address+chain can be re-created', async () => {
      const db  = makeDb();
      const app = makeApp(db);
      const id  = seed(db, { address: '0xabc', chain: 'ethereum', name: 'First' });
      await request(app).delete(`/api/address-labels/${id}`);
      const res = await request(app).post('/api/address-labels').send({
        address: '0xabc',
        chain:   'ethereum',
        name:    'Recreated',
      });
      expect(res.status).toBe(201);
      db.close();
    });
  });

} else {
  describe('addressLabels.test.js — DB integration', () => {
    test.skip('all tests skipped: better-sqlite3 native module unavailable', () => {});
  });
}
