'use strict';

const express = require('express');
const fetch = require('node-fetch');
const { validateUrl } = require('../middleware/validateEndpoint');

const router = express.Router();

const ALLOWED_KEYS = new Set([
  'endpoint',
  'warn_bytes',
  'max_bytes',
  'page_size',
  'max_page_count',
  'max_row_count',
  'timeout_per_page_ms',
  'builtin_imported',
]);

module.exports = function settingsRoutes(db) {
  // GET /api/settings — return all settings as key-value object
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // PUT /api/settings — update one or more keys
  router.put('/', async (req, res) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'bad_request', message: 'Body must be a JSON object.' });
    }

    const unknownKeys = Object.keys(updates).filter(k => !ALLOWED_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        error: 'unknown_keys',
        message: `Unknown settings keys: ${unknownKeys.join(', ')}`,
      });
    }

    try {
      const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const updateMany = db.transaction((entries) => {
        for (const [key, value] of entries) {
          updateStmt.run(key, String(value));
        }
      });
      updateMany(Object.entries(updates));

      // Return updated settings
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // GET /api/settings/ping — ping the configured endpoint
  router.get('/ping', async (req, res) => {
    let endpoint;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
      endpoint = row ? row.value : '';
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'DB error: ' + e.message });
    }

    if (!endpoint) {
      return res.json({ ok: false, error: 'No endpoint configured.' });
    }

    const errorMsg = await validateUrl(endpoint);
    if (errorMsg) {
      return res.json({ ok: false, error: errorMsg });
    }

    const start = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
        redirect: 'error',
        timeout: 10000,
      });
      const latency_ms = Date.now() - start;
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.json({ ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` });
      }
      res.json({ ok: true, latency_ms });
    } catch (e) {
      const latency_ms = Date.now() - start;
      res.json({ ok: false, error: e.message, latency_ms });
    }
  });

  return router;
};
