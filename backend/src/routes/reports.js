'use strict';

const express = require('express');
const { fetchAllPages } = require('../ponder');
const { validateUrl } = require('../middleware/validateEndpoint');

const router = express.Router();

function parseQueryRow(row) {
  let variable_defs, field_meta, chart_views;
  try { variable_defs = JSON.parse(row.variable_defs || '[]'); } catch { variable_defs = []; }
  try { field_meta = JSON.parse(row.field_meta || '{}'); } catch { field_meta = {}; }
  try { chart_views = JSON.parse(row.chart_views || '[]'); } catch { chart_views = []; }
  return { ...row, variable_defs, field_meta, chart_views };
}

function resolveVariables(queryDef, startDate, endDate) {
  let varDefs;
  try {
    varDefs = JSON.parse(queryDef.variable_defs);
  } catch (e) {
    return { variables_base: {}, error: null };
  }

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

  return { variables_base: variables, error: null };
}

module.exports = function reportsRoutes(db) {
  // GET /api/reports
  router.get('/', (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports ORDER BY name').all();
      res.json(reports);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // POST /api/reports
  router.post('/', (req, res) => {
    const { name, description = '' } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'validation_error', message: 'name is required.' });
    }
    const now = new Date().toISOString();
    try {
      const info = db.prepare('INSERT INTO reports (name, description, created_at) VALUES (?, ?, ?)').run(name, description, now);
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(report);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // GET /api/reports/:id
  router.get('/:id', (req, res) => {
    try {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const queries = db.prepare(`
        SELECT rq.position, q.*
        FROM report_queries rq
        JOIN queries q ON rq.query_id = q.id
        WHERE rq.report_id = ?
        ORDER BY rq.position
      `).all(req.params.id);

      res.json({ ...report, queries: queries.map(parseQueryRow) });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // PUT /api/reports/:id
  router.put('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { name = existing.name, description = existing.description, query_ids } = req.body || {};

      const updateReport = db.transaction(() => {
        db.prepare('UPDATE reports SET name=?, description=? WHERE id=?').run(name, description, req.params.id);

        if (Array.isArray(query_ids)) {
          db.prepare('DELETE FROM report_queries WHERE report_id=?').run(req.params.id);
          const insertQ = db.prepare('INSERT INTO report_queries (report_id, query_id, position) VALUES (?, ?, ?)');
          query_ids.forEach((qid, idx) => insertQ.run(req.params.id, qid, idx));
        }
      });
      updateReport();

      const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // DELETE /api/reports/:id
  router.delete('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });
      db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // POST /api/reports/:id/run
  router.post('/:id/run', async (req, res) => {
    try {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!report) return res.status(404).json({ error: 'not_found', message: 'Report not found.' });

      const { start_date, end_date, endpoint: reqEndpoint } = req.body || {};

      let endpoint = reqEndpoint;
      if (!endpoint) {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
        endpoint = row ? row.value : '';
      }

      if (!endpoint) {
        return res.status(400).json({ error: 'invalid_endpoint', message: 'No endpoint configured.' });
      }

      const endpointError = await validateUrl(endpoint);
      if (endpointError) {
        return res.status(400).json({ error: 'invalid_endpoint', message: endpointError });
      }

      // Fetch settings
      const settingsRows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of settingsRows) settings[row.key] = row.value;

      // Get queries in position order
      const reportQueries = db.prepare(`
        SELECT rq.position, q.*
        FROM report_queries rq
        JOIN queries q ON rq.query_id = q.id
        WHERE rq.report_id = ?
        ORDER BY rq.position ASC
      `).all(req.params.id);

      const ranAt = new Date().toISOString();

      // Create report_run record
      const reportRunInfo = db.prepare(
        'INSERT INTO report_runs (report_id, start_date, end_date, endpoint, ran_at) VALUES (?, ?, ?, ?, ?)'
      ).run(req.params.id, start_date || null, end_date || null, endpoint, ranAt);
      const reportRunId = reportRunInfo.lastInsertRowid;

      // Insert pending statuses
      const insertPending = db.prepare(
        'INSERT INTO report_run_queries (report_run_id, query_id, run_id, status) VALUES (?, ?, NULL, ?)'
      );
      for (const q of reportQueries) {
        insertPending.run(reportRunId, q.id, 'pending');
      }

      const queryResults = [];

      // Execute sequentially
      for (const queryDef of reportQueries) {
        const { variables_base } = resolveVariables(queryDef, start_date, end_date);

        const result = await fetchAllPages(
          endpoint, queryDef.gql, variables_base, queryDef, settings, null
        );

        const { rows, page_count, duration_ms, warnings, error_type, error_message, graphql_errors } = result;
        const qRanAt = new Date().toISOString();

        let runId = null;
        let status = 'failed';
        let errMsg = error_message || null;

        if (error_type === null || error_type === 'graphql_partial') {
          // Save run
          try {
            const runInfo = db.prepare(`
              INSERT INTO runs (query_id, endpoint, start_date, end_date, variables_base, rows,
                row_count, page_count, duration_ms, error_type, error_message, graphql_errors, warnings, ran_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              queryDef.id, endpoint,
              start_date || null, end_date || null,
              JSON.stringify(variables_base),
              JSON.stringify(rows),
              rows ? rows.length : 0,
              page_count, duration_ms,
              error_type || null, error_message || null,
              graphql_errors ? JSON.stringify(graphql_errors) : null,
              JSON.stringify(warnings || []),
              qRanAt
            );
            runId = runInfo.lastInsertRowid;
            status = 'ok';
          } catch (e) {
            console.error('Failed to save report query run:', e);
            errMsg = e.message;
          }
        }

        db.prepare(`
          UPDATE report_run_queries SET run_id=?, status=?, error_message=?
          WHERE report_run_id=? AND query_id=?
        `).run(runId, status, errMsg, reportRunId, queryDef.id);

        queryResults.push({ query_id: queryDef.id, run_id: runId, status, error_message: errMsg });
      }

      res.json({
        id: reportRunId,
        report_id: parseInt(req.params.id, 10),
        start_date: start_date || null,
        end_date: end_date || null,
        endpoint,
        ran_at: ranAt,
        queries: queryResults,
      });
    } catch (e) {
      res.status(500).json({ error: 'server_error', message: e.message });
    }
  });

  // GET /api/reports/runs/:report_run_id
  router.get('/runs/:report_run_id', (req, res) => {
    try {
      const reportRun = db.prepare('SELECT * FROM report_runs WHERE id = ?').get(req.params.report_run_id);
      if (!reportRun) return res.status(404).json({ error: 'not_found', message: 'Report run not found.' });

      const queryStatuses = db.prepare(`
        SELECT rrq.query_id, rrq.run_id, rrq.status, rrq.error_message
        FROM report_run_queries rrq
        WHERE rrq.report_run_id = ?
      `).all(req.params.report_run_id);

      res.json({ ...reportRun, queries: queryStatuses });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  return router;
};
