'use strict';

const express = require('express');
const { serverError } = require('../utils/errors');

function rowToLabel(row) {
  return {
    id: row.id,
    address: row.address,
    chain: row.chain,
    name: row.name,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateLabel(body) {
  if (!body.address || typeof body.address !== 'string' || !body.address.trim()) {
    return 'address is required.';
  }
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return 'name is required.';
  }
  return null;
}

module.exports = function addressLabelsRoutes(db) {
  const router = express.Router();

  // GET /api/address-labels — list all
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT * FROM address_labels ORDER BY chain, address'
      ).all();
      res.json(rows.map(rowToLabel));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // GET /api/address-labels/:id — single
  router.get('/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM address_labels WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'not_found', message: 'Label not found.' });
      res.json(rowToLabel(row));
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // POST /api/address-labels — create
  router.post('/', (req, res) => {
    const err = validateLabel(req.body);
    if (err) return res.status(400).json({ error: 'validation_error', message: err });

    const now = new Date().toISOString();
    const { address, chain = '', name, notes = '' } = req.body;

    try {
      const info = db.prepare(
        'INSERT INTO address_labels (address, chain, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(address.trim(), chain.trim(), name.trim(), notes.trim(), now, now);
      const created = db.prepare('SELECT * FROM address_labels WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(rowToLabel(created));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'conflict', message: 'A label for this address and chain already exists.' });
      }
      serverError(res, e, 'db_error');
    }
  });

  // PUT /api/address-labels/:id — update
  router.put('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM address_labels WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Label not found.' });

      const merged = { ...existing, ...req.body };
      const err = validateLabel(merged);
      if (err) return res.status(400).json({ error: 'validation_error', message: err });

      const now = new Date().toISOString();
      db.prepare(
        'UPDATE address_labels SET address=?, chain=?, name=?, notes=?, updated_at=? WHERE id=?'
      ).run(
        String(merged.address).trim(),
        String(merged.chain ?? '').trim(),
        String(merged.name).trim(),
        String(merged.notes ?? '').trim(),
        now,
        req.params.id
      );
      const updated = db.prepare('SELECT * FROM address_labels WHERE id = ?').get(req.params.id);
      res.json(rowToLabel(updated));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'conflict', message: 'A label for this address and chain already exists.' });
      }
      serverError(res, e, 'db_error');
    }
  });

  // DELETE /api/address-labels/:id — delete
  router.delete('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM address_labels WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Label not found.' });
      db.prepare('DELETE FROM address_labels WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  return router;
};
