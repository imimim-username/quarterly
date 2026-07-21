'use strict';

const express = require('express');
const { serverError } = require('../utils/errors');

function rowToEndpoint(row) {
  let headers = {};
  try { headers = JSON.parse(row.headers || '{}'); } catch {}
  return { ...row, headers, is_default: Boolean(row.is_default) };
}

function validateEndpoint(body) {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return 'name is required.';
  }
  if (body.headers !== undefined) {
    if (typeof body.headers !== 'object' || Array.isArray(body.headers) || body.headers === null) {
      return 'headers must be a JSON object.';
    }
  }
  return null;
}

module.exports = function endpointsRoutes(db) {
  const router = express.Router();

  // GET /api/endpoints — list all
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM endpoints ORDER BY name').all();
      res.json(rows.map(rowToEndpoint));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // GET /api/endpoints/:id — single
  router.get('/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'not_found', message: 'Endpoint not found.' });
      res.json(rowToEndpoint(row));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // POST /api/endpoints — create
  router.post('/', (req, res) => {
    const err = validateEndpoint(req.body);
    if (err) return res.status(400).json({ error: 'validation_error', message: err });

    const now = new Date().toISOString();
    const { name, url = '', headers = {}, is_default = false } = req.body;

    try {
      if (is_default) {
        db.prepare('UPDATE endpoints SET is_default=0').run();
      }
      const info = db.prepare(
        'INSERT INTO endpoints (name, url, headers, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        name.trim(),
        url,
        JSON.stringify(headers),
        is_default ? 1 : 0,
        now,
        now
      );
      const created = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(rowToEndpoint(created));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // PUT /api/endpoints/:id — update
  router.put('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Endpoint not found.' });

      // Merge for validation: existing has headers as string, need to parse for merge
      const existingParsed = rowToEndpoint(existing);
      const merged = { ...existingParsed, ...req.body };
      const err = validateEndpoint(merged);
      if (err) return res.status(400).json({ error: 'validation_error', message: err });

      const now = new Date().toISOString();
      const { name, url, headers, is_default } = merged;

      if (is_default) {
        db.prepare('UPDATE endpoints SET is_default=0 WHERE id != ?').run(req.params.id);
      }

      db.prepare(
        'UPDATE endpoints SET name=?, url=?, headers=?, is_default=?, updated_at=? WHERE id=?'
      ).run(
        String(name).trim(),
        url !== undefined ? url : '',
        JSON.stringify(typeof headers === 'object' && !Array.isArray(headers) && headers !== null ? headers : {}),
        is_default ? 1 : 0,
        now,
        req.params.id
      );

      const updated = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
      res.json(rowToEndpoint(updated));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // DELETE /api/endpoints/:id — delete
  router.delete('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM endpoints WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Endpoint not found.' });
      db.prepare('DELETE FROM endpoints WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  return router;
};
