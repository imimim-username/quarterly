'use strict';

const express = require('express');

const SCHEMA_VERSION = 1;
const ALLOWED_SETTINGS = ['endpoint', 'warn_bytes', 'max_bytes', 'page_size', 'max_page_count', 'max_row_count', 'timeout_per_page_ms'];

// Fields included in a query export
const QUERY_EXPORT_FIELDS = [
  'name', 'description', 'category', 'gql', 'variable_defs', 'result_path',
  'pagination_style', 'cursor_path', 'has_next_path', 'date_format',
  'chain_mode', 'chain_var_name', 'chain_field', 'field_meta', 'key_field',
  'is_builtin', 'chart_views', 'computed_columns', 'timestamp_extraction',
];

// Maps logical field group names to DB column names
const QUERY_FIELD_GROUPS = {
  gql: ['gql'],
  variables: ['variable_defs'],
  display: ['field_meta', 'key_field', 'chart_views', 'computed_columns'],
  info: ['description', 'category'],
  execution: ['result_path', 'pagination_style', 'cursor_path', 'has_next_path', 'date_format', 'chain_mode', 'chain_var_name', 'chain_field', 'timestamp_extraction'],
};

// Columns that must be JSON-serialised when written to the DB
const JSON_COLUMNS = new Set(['variable_defs', 'field_meta', 'chart_views', 'computed_columns', 'timestamp_extraction']);

function rowToExportQuery(row) {
  const q = {};
  for (const f of QUERY_EXPORT_FIELDS) q[f] = row[f];
  // Parse JSON fields so the bundle contains proper objects/arrays, not strings
  try { q.variable_defs = JSON.parse(row.variable_defs || '[]'); } catch { q.variable_defs = []; }
  try { q.field_meta = JSON.parse(row.field_meta || '{}'); } catch { q.field_meta = {}; }
  try { q.chart_views = JSON.parse(row.chart_views || '[]'); } catch { q.chart_views = []; }
  try { q.computed_columns = JSON.parse(row.computed_columns || '[]'); } catch { q.computed_columns = []; }
  try { q.timestamp_extraction = row.timestamp_extraction ? JSON.parse(row.timestamp_extraction) : null; } catch { q.timestamp_extraction = null; }
  return q;
}

module.exports = function transferRoutes(db) {
  const router = express.Router();
  // ─── EXPORT ────────────────────────────────────────────────────────────────

  // POST /api/transfer/export
  // Body: { queryIds: [1,2,3] | null, includeAddressLabels: bool, includeSettings: bool }
  router.post('/export', (req, res) => {
    try {
      const { queryIds = null, includeAddressLabels = true, includeSettings = true } = req.body || {};

      let appVersion = '1.0.0';
      try { appVersion = require('../../../package.json').version; } catch {}

      const bundle = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion,
      };

      // Queries
      if (queryIds !== false) {
        let rows;
        if (Array.isArray(queryIds) && queryIds.length > 0) {
          const placeholders = queryIds.map(() => '?').join(',');
          rows = db.prepare(`SELECT * FROM queries WHERE id IN (${placeholders})`).all(...queryIds);
        } else {
          rows = db.prepare('SELECT * FROM queries ORDER BY category, name').all();
        }
        bundle.queries = rows.map(rowToExportQuery);
      }

      // Address labels
      if (includeAddressLabels) {
        bundle.addressLabels = db.prepare('SELECT address, chain, name, notes FROM address_labels ORDER BY chain, address').all();
      }

      // Settings (only user-relevant ones, not builtin_imported)
      if (includeSettings) {
        const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${ALLOWED_SETTINGS.map(() => '?').join(',')})`).all(...ALLOWED_SETTINGS);
        bundle.settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
      }

      res.json(bundle);
    } catch (e) {
      console.error('Export error:', e);
      res.status(500).json({ error: 'export_failed', message: e.message });
    }
  });

  // ─── PREVIEW ───────────────────────────────────────────────────────────────

  // POST /api/transfer/preview
  // Body: the raw bundle JSON
  router.post('/preview', (req, res) => {
    try {
      const bundle = req.body;
      if (!bundle || typeof bundle.schemaVersion !== 'number') {
        return res.status(400).json({ error: 'invalid_bundle', message: 'Missing or invalid schemaVersion.' });
      }

      const result = {
        schemaVersion: bundle.schemaVersion,
        exportedAt: bundle.exportedAt,
        appVersion: bundle.appVersion,
      };

      // Queries
      if (Array.isArray(bundle.queries)) {
        result.queries = bundle.queries.map(q => {
          const existing = db.prepare('SELECT id, is_builtin FROM queries WHERE name = ?').get(q.name);
          return {
            name: q.name,
            category: q.category || '',
            status: existing ? 'conflict' : 'new',
            existingId: existing?.id ?? null,
            isBuiltin: Boolean(q.is_builtin),
          };
        });
      }

      // Address labels
      if (Array.isArray(bundle.addressLabels)) {
        result.addressLabels = bundle.addressLabels.map(l => {
          const existing = db.prepare('SELECT name FROM address_labels WHERE address = ? AND chain = ?').get(l.address, l.chain);
          return {
            address: l.address,
            chain: l.chain,
            name: l.name,
            status: existing ? 'conflict' : 'new',
            existingName: existing?.name ?? null,
          };
        });
      }

      // Settings
      if (bundle.settings && typeof bundle.settings === 'object') {
        const currentRows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${ALLOWED_SETTINGS.map(() => '?').join(',')})`).all(...ALLOWED_SETTINGS);
        const current = Object.fromEntries(currentRows.map(r => [r.key, r.value]));
        result.settings = { incoming: bundle.settings, current };
      }

      res.json(result);
    } catch (e) {
      console.error('Preview error:', e);
      res.status(500).json({ error: 'preview_failed', message: e.message });
    }
  });

  // ─── IMPORT ────────────────────────────────────────────────────────────────

  // POST /api/transfer/import
  // Body: { bundle: {...}, decisions: { queries: [...], addressLabels: [...], settings: [...] } }
  router.post('/import', (req, res) => {
    try {
      const { bundle, decisions } = req.body || {};
      if (!bundle || !decisions) {
        return res.status(400).json({ error: 'invalid_request', message: 'bundle and decisions are required.' });
      }

      const queryResults = [];
      const labelResults = [];
      const settingResults = [];

      const doImport = db.transaction(() => {
        // ── Queries ──
        const queryDecisions = decisions.queries || [];
        const bundleQueries = bundle.queries || [];

        for (const decision of queryDecisions) {
          if (decision.action === 'skip') {
            queryResults.push({ name: decision.name, action: 'skipped' });
            continue;
          }

          const bundleQuery = bundleQueries.find(q => q.name === decision.name);
          if (!bundleQuery) continue;

          const fields = decision.fields || Object.keys(QUERY_FIELD_GROUPS);
          // Expand field group names to actual column names
          const cols = new Set();
          for (const f of fields) {
            if (QUERY_FIELD_GROUPS[f]) {
              for (const c of QUERY_FIELD_GROUPS[f]) cols.add(c);
            } else {
              cols.add(f);
            }
          }

          const serialize = (val) => (typeof val === 'string' ? val : JSON.stringify(val ?? null));

          if (decision.action === 'overwrite') {
            const existing = db.prepare('SELECT id FROM queries WHERE name = ?').get(bundleQuery.name);
            if (!existing) {
              // Shouldn't happen, but fall back to create
              decision.action = 'create_new';
            } else {
              // Build SET clause for only the requested columns
              const setClauses = [];
              const values = [];
              for (const col of cols) {
                if (col === 'name') continue; // never overwrite the name
                if (bundleQuery[col] === undefined) continue;
                setClauses.push(`${col} = ?`);
                const v = bundleQuery[col];
                values.push(JSON_COLUMNS.has(col) ? serialize(v) : v);
              }
              if (setClauses.length > 0) {
                setClauses.push('updated_at = ?');
                values.push(new Date().toISOString(), existing.id);
                db.prepare(`UPDATE queries SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
              }
              queryResults.push({ name: bundleQuery.name, action: 'updated', id: existing.id });
              continue;
            }
          }

          if (decision.action === 'create_new') {
            // Try the original name first (covers truly-new queries with no conflict).
            // If taken (conflict "Create new" case) fall back to "(imported)" suffix.
            let newName = bundleQuery.name;
            if (db.prepare('SELECT id FROM queries WHERE name = ?').get(newName)) {
              newName = bundleQuery.name + ' (imported)';
              let suffix = 2;
              while (db.prepare('SELECT id FROM queries WHERE name = ?').get(newName)) {
                newName = `${bundleQuery.name} (imported ${suffix++})`;
              }
            }
            const now = new Date().toISOString();
            const result = db.prepare(`
              INSERT INTO queries
                (name, description, category, gql, variable_defs, result_path,
                 pagination_style, cursor_path, has_next_path, date_format,
                 chain_mode, chain_var_name, chain_field, field_meta, key_field,
                 is_builtin, chart_views, computed_columns, timestamp_extraction,
                 created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              newName,
              bundleQuery.description || '',
              bundleQuery.category || '',
              bundleQuery.gql || '',
              serialize(bundleQuery.variable_defs ?? []),
              bundleQuery.result_path || '',
              bundleQuery.pagination_style || 'none',
              bundleQuery.cursor_path || '',
              bundleQuery.has_next_path || '',
              bundleQuery.date_format || 'unix_seconds',
              bundleQuery.chain_mode || 'none',
              bundleQuery.chain_var_name || '',
              bundleQuery.chain_field || '',
              serialize(bundleQuery.field_meta ?? {}),
              bundleQuery.key_field || 'id',
              bundleQuery.is_builtin ? 1 : 0,
              serialize(bundleQuery.chart_views ?? []),
              serialize(bundleQuery.computed_columns ?? []),
              bundleQuery.timestamp_extraction != null ? serialize(bundleQuery.timestamp_extraction) : null,
              now,
              now,
            );
            queryResults.push({ name: newName, originalName: bundleQuery.name, action: 'created', id: result.lastInsertRowid });
          }
        }

        // ── Address Labels ──
        const labelDecisions = decisions.addressLabels || [];
        const bundleLabels = bundle.addressLabels || [];

        for (const decision of labelDecisions) {
          const bundleLabel = bundleLabels.find(l => l.address === decision.address && l.chain === decision.chain);
          if (!bundleLabel) continue;

          if (decision.action === 'skip') {
            labelResults.push({ address: decision.address, chain: decision.chain, action: 'skipped' });
            continue;
          }

          if (decision.action === 'overwrite') {
            const existing = db.prepare('SELECT id FROM address_labels WHERE address = ? AND chain = ?').get(bundleLabel.address, bundleLabel.chain);
            if (existing) {
              db.prepare('UPDATE address_labels SET name = ?, notes = ?, updated_at = ? WHERE id = ?')
                .run(bundleLabel.name, bundleLabel.notes || '', new Date().toISOString(), existing.id);
              labelResults.push({ address: bundleLabel.address, chain: bundleLabel.chain, action: 'updated' });
              continue;
            }
            // Fall through to insert if somehow not found
          }

          // New (or overwrite-but-not-found)
          const now = new Date().toISOString();
          try {
            db.prepare('INSERT INTO address_labels (address, chain, name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?)')
              .run(bundleLabel.address, bundleLabel.chain, bundleLabel.name, bundleLabel.notes || '', now, now);
            labelResults.push({ address: bundleLabel.address, chain: bundleLabel.chain, action: 'created' });
          } catch (e) {
            // UNIQUE constraint — treat as update
            db.prepare('UPDATE address_labels SET name = ?, notes = ?, updated_at = ? WHERE address = ? AND chain = ?')
              .run(bundleLabel.name, bundleLabel.notes || '', now, bundleLabel.address, bundleLabel.chain);
            labelResults.push({ address: bundleLabel.address, chain: bundleLabel.chain, action: 'updated' });
          }
        }

        // ── Settings ──
        const settingKeys = (decisions.settings || []).filter(k => ALLOWED_SETTINGS.includes(k));
        const incomingSettings = bundle.settings || {};
        for (const key of settingKeys) {
          if (incomingSettings[key] !== undefined) {
            db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(incomingSettings[key]), key);
            settingResults.push(key);
          }
        }
      });

      doImport();

      res.json({
        queries: queryResults,
        addressLabels: labelResults,
        settings: settingResults,
      });
    } catch (e) {
      console.error('Import error:', e);
      res.status(500).json({ error: 'import_failed', message: e.message });
    }
  });

  return router;
};
