'use strict';

const express = require('express');

module.exports = function colorSchemesRoutes(db) {
  const router = express.Router();

  /** Allowed keys inside the theme object. */
  const ALLOWED_THEME_KEYS = ['bg', 'textColor', 'axisColor', 'gridColor'];

  /** Parse a DB row — deserialise colors + theme JSON, coerce is_default to boolean. */
  function parse(row) {
    if (!row) return null;
    let colors;
    try { colors = JSON.parse(row.colors) } catch { colors = [] }
    if (!Array.isArray(colors)) colors = [];

    let theme = null;
    if (row.theme) {
      try { theme = JSON.parse(row.theme) } catch { theme = null }
      if (typeof theme !== 'object' || Array.isArray(theme)) theme = null;
    }

    return { ...row, colors, theme, is_default: row.is_default === 1 };
  }

  /** Return true if value is a valid CSS hex color (#rgb or #rrggbb). */
  function isValidHex(v) {
    return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/.test(v);
  }

  /** Validate an optional theme object; returns { ok, error } */
  function validateTheme(theme) {
    if (theme == null) return { ok: true, themeJson: null };
    if (typeof theme !== 'object' || Array.isArray(theme)) {
      return { ok: false, error: 'theme must be an object' };
    }
    for (const [key, val] of Object.entries(theme)) {
      if (!ALLOWED_THEME_KEYS.includes(key)) {
        return { ok: false, error: `unknown theme key: ${key}` };
      }
      if (val !== null && !isValidHex(val)) {
        return { ok: false, error: `theme.${key} must be a valid hex color (#rgb or #rrggbb) or null` };
      }
    }
    return { ok: true, themeJson: JSON.stringify(theme) };
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
    const { name, colors, theme } = req.body || {};
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

    const themeResult = validateTheme(theme !== undefined ? theme : null);
    if (!themeResult.ok) {
      return res.status(400).json({ error: 'invalid', message: themeResult.error });
    }

    const now = new Date().toISOString();
    try {
      const result = db.prepare(
        'INSERT INTO color_schemes (name, colors, theme, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ).run(name.trim(), JSON.stringify(colors), themeResult.themeJson, now, now);
      const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(parse(row));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'conflict', message: 'A scheme with that name already exists' });
      }
      throw e;
    }
  });

  // PUT /api/color-schemes/:id — update name, colors, and/or theme
  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, colors, theme } = req.body || {};
    const newName = (name !== undefined ? name.trim() : existing.name);
    let newColors;
    if (Array.isArray(colors)) {
      newColors = colors;
    } else {
      try { newColors = JSON.parse(existing.colors) } catch { newColors = [] }
      if (!Array.isArray(newColors)) newColors = [];
    }

    // Theme: use incoming value if provided; otherwise preserve existing
    let incomingTheme;
    if (theme !== undefined) {
      incomingTheme = theme; // explicit null clears the theme
    } else {
      try { incomingTheme = existing.theme ? JSON.parse(existing.theme) : null } catch { incomingTheme = null }
    }

    if (!newName) return res.status(400).json({ error: 'invalid', message: 'name cannot be empty' });
    if (newName.length > 255) return res.status(400).json({ error: 'invalid', message: 'name must be 255 characters or fewer' });
    if (newColors.length === 0) return res.status(400).json({ error: 'invalid', message: 'colors cannot be empty' });
    if (newColors.length > 100) return res.status(400).json({ error: 'invalid', message: 'colors array must have 100 entries or fewer' });
    if (!newColors.every(isValidHex)) return res.status(400).json({ error: 'invalid', message: 'each color must be a valid hex string (#rgb or #rrggbb)' });

    const themeResult = validateTheme(incomingTheme);
    if (!themeResult.ok) {
      return res.status(400).json({ error: 'invalid', message: themeResult.error });
    }

    const now = new Date().toISOString();
    try {
      db.prepare(
        'UPDATE color_schemes SET name = ?, colors = ?, theme = ?, updated_at = ? WHERE id = ?',
      ).run(newName, JSON.stringify(newColors), themeResult.themeJson, now, req.params.id);
      const row = db.prepare('SELECT * FROM color_schemes WHERE id = ?').get(req.params.id);
      res.json(parse(row));
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'conflict', message: 'A scheme with that name already exists' });
      }
      throw e;
    }
  });

  // DELETE /api/color-schemes/:id — delete (protected: cannot delete default or last scheme)
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
