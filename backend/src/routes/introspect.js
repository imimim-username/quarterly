'use strict';

const express = require('express');
const fetch = require('node-fetch');
const { validateUrl } = require('../middleware/validateEndpoint');

const router = express.Router();

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

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: INTROSPECTION_QUERY }),
        redirect: 'error',
        timeout: 15000,
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
      res.status(502).json({ error: 'network', message: e.message });
    }
  });

  return router;
};
