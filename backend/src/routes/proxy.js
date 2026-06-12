'use strict';

const express = require('express');
const { validateUrl } = require('../middleware/validateEndpoint');


module.exports = function proxyRoutes(db) {
  const router = express.Router();
  // POST /api/proxy
  // Proxies a GraphQL request to the configured endpoint through the
  // backend's SSRF protection layer. Used by the frontend SchemaExplorer
  // (GraphiQL) so that all traffic — including schema introspection —
  // goes through validateUrl rather than directly from the browser.
  router.post('/', async (req, res) => {
    // Load endpoint from settings
    const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
    const endpoint = row ? row.value : '';

    if (!endpoint) {
      return res.status(400).json({ error: 'invalid_endpoint', message: 'No endpoint configured.' });
    }

    const errorMsg = await validateUrl(endpoint);
    if (errorMsg) {
      return res.status(400).json({ error: 'invalid_endpoint', message: errorMsg });
    }

    const { query, variables, operationName } = req.body || {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'bad_request', message: 'Body must include a "query" string.' });
    }

    const pageAbort = new AbortController();
    const timer = setTimeout(() => pageAbort.abort(), 30000);

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables, operationName }),
        redirect: 'error',
        signal: pageAbort.signal,
      });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        return res.status(502).json({
          error: 'upstream_error',
          message: `HTTP ${upstream.status}: ${text.slice(0, 200)}`,
        });
      }

      const data = await upstream.json();
      return res.json(data);
    } catch (e) {
      if (e.name === 'AbortError') {
        return res.status(504).json({ error: 'timeout', message: 'Upstream request timed out after 30s.' });
      }
      return res.status(502).json({ error: 'network', message: e.message });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
