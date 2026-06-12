'use strict';

const express = require('express');
const { validateUrl } = require('../middleware/validateEndpoint');


const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      types {
        name
        kind
        fields {
          name
        }
      }
    }
  }
`;

module.exports = function introspectRoutes(db) {
  const router = express.Router();
  // POST /api/introspect
  router.post('/', async (req, res) => {
    let endpoint = (req.body && req.body.endpoint) || null;

    if (!endpoint) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
      endpoint = row ? row.value : '';
    }

    if (!endpoint) {
      return res.status(400).json({ error: 'invalid_endpoint', message: 'No endpoint configured.' });
    }

    const errorMsg = await validateUrl(endpoint);
    if (errorMsg) {
      return res.status(400).json({ error: 'invalid_endpoint', message: errorMsg });
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: INTROSPECTION_QUERY }),
        redirect: 'error',
        signal: abort.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.status(502).json({ error: 'network', message: `HTTP ${response.status}: ${text.slice(0, 200)}` });
      }

      const data = await response.json();

      if (data.errors) {
        return res.status(400).json({ error: 'graphql', message: data.errors.map(e => e.message).join('; ') });
      }

      // Simplify the type map
      const types = {};
      if (data.data && data.data.__schema && data.data.__schema.types) {
        for (const type of data.data.__schema.types) {
          if (type.name.startsWith('__')) continue; // Skip introspection types
          if (type.kind === 'OBJECT' && type.fields) {
            types[type.name] = { fields: type.fields.map(f => f.name) };
          }
        }
      }

      res.json({ types });
    } catch (e) {
      if (e.name === 'AbortError') {
        return res.status(504).json({ error: 'timeout', message: 'Introspection request timed out after 15s.' });
      }
      res.status(502).json({ error: 'network', message: e.message });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
