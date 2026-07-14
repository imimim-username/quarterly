'use strict';

const express = require('express');
const { fetchAllPages } = require('../ponder');
const { validateUrl } = require('../middleware/validateEndpoint');

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseQueryRow(row) {
  let variable_defs, field_meta, chart_views, computed_columns, timestamp_extraction;
  try { variable_defs = JSON.parse(row.variable_defs || '[]'); } catch { variable_defs = []; }
  try { field_meta = JSON.parse(row.field_meta || '{}'); } catch { field_meta = {}; }
  try { chart_views = JSON.parse(row.chart_views || '[]'); } catch { chart_views = []; }
  try { computed_columns = JSON.parse(row.computed_columns || '[]'); } catch { computed_columns = []; }
  try { timestamp_extraction = row.timestamp_extraction ? JSON.parse(row.timestamp_extraction) : null; } catch { timestamp_extraction = null; }
  return { ...row, variable_defs, field_meta, chart_views, computed_columns, timestamp_extraction };
}

function parseInstance(row) {
  let config;
  try { config = JSON.parse(row.config || '{}'); } catch { config = {}; }
  return { ...row, config };
}

function resolveVariables(queryDef, startDate, endDate) {
  let varDefs;
  try { varDefs = JSON.parse(queryDef.variable_defs); } catch { return { variables_base: {} }; }

  const variables = {};
  const PAGINATION_SOURCES = new Set(['pagination_first', 'pagination_skip', 'pagination_after']);

  for (const def of varDefs) {
    if (PAGINATION_SOURCES.has(def.source)) continue;
    if (def.source === 'global_start' && startDate) {
      const date = new Date(startDate);
      if (queryDef.date_format === 'unix_seconds') variables[def.name] = Math.floor(date.getTime() / 1000);
      else if (queryDef.date_format === 'unix_ms') variables[def.name] = date.getTime();
      else variables[def.name] = date.toISOString();
    } else if (def.source === 'global_end' && endDate) {
      const date = new Date(endDate);
      if (queryDef.date_format === 'unix_seconds') variables[def.name] = Math.floor(date.getTime() / 1000);
      else if (queryDef.date_format === 'unix_ms') variables[def.name] = date.getTime();
      else variables[def.name] = date.toISOString();
    } else if ((def.source === 'user' || def.source === 'none') && def.default !== undefined) {
      variables[def.name] = def.default;
    }
  }
  return { variables_base: variables };
}

// ─── Router ─────────────────────────────────────────────────────────────────

module.exports = function reportsRoutes(db) {
  const router = express.Router();

  // ── List reports ────────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports ORDER BY name').all();
      res.json(reports);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Create report ───────────────────────────────────────────────────────
  router.post('/', (req, res) => {
    const { name, description = '' } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'validation_error', message: 'name is required.' });
    }
    const now = new Date().toISOString();
    try {
      const info = db.prepare(
        'INSERT INTO reports (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(name.trim(), description, now, now);
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json({ ...report, instances: [] });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Get report (with instances) ─────────────────────────────────────────
  router.get('/:id(\\d+)', (req, res) => {
    try {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const instanceRows = db.prepare(`
        SELECT ri.*, q.name AS query_name, q.category AS query_category,
               q.field_meta, q.computed_columns, q.timestamp_extraction,
               q.variable_defs, q.gql, q.result_path, q.pagination_style,
               q.cursor_path, q.has_next_path, q.date_format,
               q.chain_mode, q.chain_var_name, q.chain_field, q.key_field
        FROM report_instances ri
        JOIN queries q ON ri.query_id = q.id
        WHERE ri.report_id = ?
        ORDER BY ri.position, ri.id
      `).all(req.params.id);

      const instances = instanceRows.map(row => {
        const { config, ...rest } = parseInstance(row);
        const query = parseQueryRow({
          id: row.query_id,
          name: row.query_name,
          category: row.query_category,
          field_meta: row.field_meta,
          computed_columns: row.computed_columns,
          timestamp_extraction: row.timestamp_extraction,
          variable_defs: row.variable_defs,
          gql: row.gql,
          result_path: row.result_path,
          pagination_style: row.pagination_style,
          cursor_path: row.cursor_path,
          has_next_path: row.has_next_path,
          date_format: row.date_format,
          chain_mode: row.chain_mode,
          chain_var_name: row.chain_var_name,
          chain_field: row.chain_field,
          key_field: row.key_field,
        });
        return { id: rest.id, report_id: rest.report_id, query_id: rest.query_id,
                 position: rest.position, label: rest.label, created_at: rest.created_at,
                 config, query };
      });

      res.json({ ...report, instances });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Update report (name, description, reorder instances) ────────────────
  router.put('/:id(\\d+)', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { name = existing.name, description = existing.description } = req.body || {};
      const now = new Date().toISOString();
      db.prepare('UPDATE reports SET name=?, description=?, updated_at=? WHERE id=?')
        .run(name, description, now, req.params.id);

      const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Delete report ───────────────────────────────────────────────────────
  router.delete('/:id(\\d+)', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });
      db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Add instance to report ──────────────────────────────────────────────
  router.post('/:id(\\d+)/instances', (req, res) => {
    try {
      const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { query_id, label = '', config = {}, position } = req.body || {};
      if (!query_id) return res.status(400).json({ error: 'validation_error', message: 'query_id is required.' });

      const query = db.prepare('SELECT id FROM queries WHERE id = ?').get(query_id);
      if (!query) return res.status(400).json({ error: 'validation_error', message: 'Query not found.' });

      // Auto-position at end if not specified
      const pos = position != null ? position : (() => {
        const row = db.prepare('SELECT MAX(position) as m FROM report_instances WHERE report_id=?').get(req.params.id);
        return (row?.m ?? -1) + 1;
      })();

      const now = new Date().toISOString();
      const info = db.prepare(
        'INSERT INTO report_instances (report_id, query_id, position, label, config, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(req.params.id, query_id, pos, label, JSON.stringify(config), now);

      const instance = db.prepare('SELECT * FROM report_instances WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(parseInstance(instance));
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Update instance (label, config, position) ───────────────────────────
  router.put('/:id(\\d+)/instances/:iid(\\d+)', (req, res) => {
    try {
      const instance = db.prepare('SELECT * FROM report_instances WHERE id = ? AND report_id = ?')
        .get(req.params.iid, req.params.id);
      if (!instance) return res.status(404).json({ error: 'not_found', message: 'Instance not found.' });

      const { label = instance.label, config, position = instance.position } = req.body || {};
      const configStr = config !== undefined ? JSON.stringify(config) : instance.config;

      db.prepare('UPDATE report_instances SET label=?, config=?, position=? WHERE id=?')
        .run(label, configStr, position, req.params.iid);

      const updated = db.prepare('SELECT * FROM report_instances WHERE id = ?').get(req.params.iid);
      res.json(parseInstance(updated));
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Delete instance ─────────────────────────────────────────────────────
  router.delete('/:id(\\d+)/instances/:iid(\\d+)', (req, res) => {
    try {
      const instance = db.prepare('SELECT id FROM report_instances WHERE id = ? AND report_id = ?')
        .get(req.params.iid, req.params.id);
      if (!instance) return res.status(404).json({ error: 'not_found', message: 'Instance not found.' });
      db.prepare('DELETE FROM report_instances WHERE id = ?').run(req.params.iid);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Bulk-save instances (replaces all instances for a report) ────────────
  // Body: { instances: [{ query_id, label, config, position }] }
  router.put('/:id(\\d+)/instances', (req, res) => {
    try {
      const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { instances = [] } = req.body || {};

      // Validate all query_ids before starting the transaction
      for (const inst of instances) {
        if (!inst.query_id) {
          return res.status(400).json({ error: 'validation_error', message: 'Each instance must have a query_id.' });
        }
        const q = db.prepare('SELECT id FROM queries WHERE id = ?').get(inst.query_id);
        if (!q) {
          return res.status(400).json({ error: 'validation_error', message: `Query with id ${inst.query_id} not found.` });
        }
      }

      const now = new Date().toISOString();

      const save = db.transaction(() => {
        db.prepare('DELETE FROM report_instances WHERE report_id = ?').run(req.params.id);
        const insert = db.prepare(
          'INSERT INTO report_instances (report_id, query_id, position, label, config, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        instances.forEach((inst, idx) => {
          insert.run(req.params.id, inst.query_id, inst.position ?? idx, inst.label ?? '', JSON.stringify(inst.config ?? {}), now);
        });
        db.prepare('UPDATE reports SET updated_at=? WHERE id=?').run(now, req.params.id);
      });
      save();

      const saved = db.prepare('SELECT * FROM report_instances WHERE report_id=? ORDER BY position, id').all(req.params.id);
      res.json(saved.map(parseInstance));
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Legacy: list report runs ────────────────────────────────────────────
  router.get('/:id(\\d+)/runs', (req, res) => {
    try {
      const runs = db.prepare('SELECT * FROM report_runs WHERE report_id=? ORDER BY ran_at DESC LIMIT 50').all(req.params.id);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Legacy: get single report run ───────────────────────────────────────
  router.get('/runs/:report_run_id(\\d+)', (req, res) => {
    try {
      const reportRun = db.prepare('SELECT * FROM report_runs WHERE id = ?').get(req.params.report_run_id);
      if (!reportRun) return res.status(404).json({ error: 'not_found', message: 'Report run not found.' });
      const queryStatuses = db.prepare(
        'SELECT rrq.query_id, rrq.run_id, rrq.status, rrq.error_message FROM report_run_queries rrq WHERE rrq.report_run_id = ?'
      ).all(req.params.report_run_id);
      res.json({ ...reportRun, queries: queryStatuses });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // ── Legacy: run all queries in a report ─────────────────────────────────
  router.post('/:id(\\d+)/run', async (req, res) => {
    try {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { start_date, end_date, endpoint: reqEndpoint } = req.body || {};
      let endpoint = reqEndpoint;
      if (!endpoint) {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
        endpoint = row ? row.value : '';
      }
      if (!endpoint) return res.status(400).json({ error: 'invalid_endpoint', message: 'No endpoint configured.' });

      const endpointError = await validateUrl(endpoint);
      if (endpointError) return res.status(400).json({ error: 'invalid_endpoint', message: endpointError });

      const settingsRows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of settingsRows) settings[row.key] = row.value;

      // Use instances if available, fall back to legacy report_queries
      let reportQueries = db.prepare(`
        SELECT ri.position, q.*
        FROM report_instances ri
        JOIN queries q ON ri.query_id = q.id
        WHERE ri.report_id = ?
        ORDER BY ri.position ASC
      `).all(req.params.id);

      if (reportQueries.length === 0) {
        reportQueries = db.prepare(`
          SELECT rq.position, q.*
          FROM report_queries rq
          JOIN queries q ON rq.query_id = q.id
          WHERE rq.report_id = ?
          ORDER BY rq.position ASC
        `).all(req.params.id);
      }

      const ranAt = new Date().toISOString();
      const reportRunInfo = db.prepare(
        'INSERT INTO report_runs (report_id, start_date, end_date, endpoint, ran_at) VALUES (?, ?, ?, ?, ?)'
      ).run(req.params.id, start_date || null, end_date || null, endpoint, ranAt);
      const reportRunId = reportRunInfo.lastInsertRowid;

      const queryResults = [];
      for (const queryDef of reportQueries) {
        const { variables_base } = resolveVariables(queryDef, start_date, end_date);
        const result = await fetchAllPages(endpoint, queryDef.gql, variables_base, queryDef, settings, null);
        const { rows, page_count, duration_ms, warnings, error_type, error_message, graphql_errors } = result;
        const qRanAt = new Date().toISOString();

        let runId = null, status = 'failed', errMsg = error_message || null;
        if (error_type === null || error_type === 'graphql_partial') {
          try {
            const runInfo = db.prepare(`
              INSERT INTO runs (query_id, endpoint, start_date, end_date, variables_base, rows,
                row_count, page_count, duration_ms, error_type, error_message, graphql_errors, warnings, ran_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(queryDef.id, endpoint, start_date || null, end_date || null,
              JSON.stringify(variables_base), JSON.stringify(rows), rows?.length ?? 0,
              page_count, duration_ms, error_type || null, error_message || null,
              graphql_errors ? JSON.stringify(graphql_errors) : null,
              JSON.stringify(warnings || []), qRanAt);
            runId = runInfo.lastInsertRowid;
            status = 'ok';
          } catch (e) { errMsg = e.message; }
        }

        db.prepare(
          'INSERT INTO report_run_queries (report_run_id, query_id, run_id, status, error_message) VALUES (?, ?, ?, ?, ?)'
        ).run(reportRunId, queryDef.id, runId, status, errMsg);
        queryResults.push({ query_id: queryDef.id, run_id: runId, status, error_message: errMsg });
      }

      res.json({ id: reportRunId, report_id: parseInt(req.params.id, 10),
        start_date: start_date || null, end_date: end_date || null, endpoint, ran_at: ranAt, queries: queryResults });
    } catch (e) {
      res.status(500).json({ error: 'server_error', message: e.message });
    }
  });

  return router;
};
