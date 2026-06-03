'use strict';

const express = require('express');

module.exports = function colorSchemesRoutes(db) {
  const router = express.Router();

  /** Parse a DB row — deserialise the colors JSON array and coerce is_default to boolean. */
  function parse(row) {
    if (!row) return null;
    let colors;
    try { colors = JSON.parse(row.colors) } catch { colors = [] }
    if (!Array.isArray(colors)) colors = [];
    return { ...row, colors, is_default: row.is_default === 1 };
  }

  /** Return true if value is a valid CSS hex color (#rgb or #rrggbb). */
  function isValidHex(v) {
    return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/.test(v);
  }

  // GET /api/color-schemes — list all
  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM color_schemes ORDER BY id').all();
    res.json(rows.map(parse));
  });

  // GET /api/color-schemes/:id — get one
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(parse(row));
  });

  // POST /api/color-schemes — create
  router.post('/', (req, res) => {
    const { name, colors } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'invalid', message: 'name is required' });
    }
    if (name.trim().length > 255) {
      return res.status(400).json({ error: 'invalid', message: 'name must be 255 characters or fewer' });
    }
    if (!Array.isArray(colors) || colors.length === 0) {
      return res.status(400).json({ error: 'invalid', message: 'colors must be a non-empty array' });
    }
    if (colors.length > 100) {
      return res.status(400).json({ error: 'invalid', message: 'colors array must have 100 entries or fewer' });
    }
    if (!colors.every(isValidHex)) {
      return res.status(400).json({ error: 'invalid', message: 'each color must be a valid hex string (#rgb or #rrggbb)' });
    }
    const now = new Date().toISOString();
    try {
      const result = db.prepare(
        'INSERT INTO color_schemes (name, colors, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      ).run(name.trim(), JSON.stringify(colors), now, now);
      const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(parse(row));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'conflict', message: 'A scheme with that name already exists' });
      }
      throw e;
    }
  });

  // PUT /api/color-schemes/:id — update name and/or colors
  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, colors } = req.body || {};
    const newName = (name !== undefined ? name.trim() : existing.name);
    let newColors;
    if (Array.isArray(colors)) {
      newColors = colors;
    } else {
      try { newColors = JSON.parse(existing.colors) } catch { newColors = [] }
      if (!Array.isArray(newColors)) newColors = [];
    }

    if (!newName) return res.status(400).json({ error: 'invalid', message: 'name cannot be empty' });
    if (newName.length > 255) return res.status(400).json({ error: 'invalid', message: 'name must be 255 characters or fewer' });
    if (newColors.length === 0) return res.status(400).json({ error: 'invalid', message: 'colors cannot be empty' });
    if (newColors.length > 100) return res.status(400).json({ error: 'invalid', message: 'colors array must have 100 entries or fewer' });
    if (!newColors.every(isValidHex)) return res.status(400).json({ error: 'invalid', message: 'each color must be a valid hex string (#rgb or #rrggbb)' });

    const now = new Date().toISOString();
    try {
      db.prepare(
        'UPDATE color_schemes SET name = ?, colors = ?, updated_at = ? WHERE id = ?',
      ).run(newName, JSON.stringify(newColors), now, req.params.id);
      const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
      res.json(parse(row));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'conflict', message: 'A scheme with that name already exists' });
      }
      throw e;
    }
  });

  // DELETE /api/color-schemes/:id — delete (protected: cannot delete the default or the last scheme)
  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    if (existing.is_default) {
      return res.status(400).json({
        error: 'cannot_delete_default',
        message: 'Set another scheme as default before deleting this one',
      });
    }

    const count = db.prepare('SELECT COUNT(*) as c FROM color_schemes').get().c;
    if (count <= 1) {
      return res.status(400).json({ error: 'last_scheme', message: 'Cannot delete the only color scheme' });
    }

    db.prepare('DELETE FROM color_schemes WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // POST /api/color-schemes/:id/set-default — designate a scheme as the default
  router.post('/:id/set-default', (req, res) => {
    const existing = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE color_schemes SET is_default = 0, updated_at = ? WHERE is_default = 1').run(now);
      db.prepare('UPDATE color_schemes SET is_default = 1, updated_at = ? WHERE id = ?').run(now, req.params.id);
    })();

    const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    res.json(parse(row));
  });

  return router;
};
