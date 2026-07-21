'use strict';

const express = require('express');
const { fetchAllPages } = require('../ponder');
const { serverError } = require('../utils/errors');
const { validateUrl } = require('../middleware/validateEndpoint');
const { autoInjectDateFilter } = require('../utils/autoInjectDateFilter');

// Error type to HTTP status mapping
const ERROR_STATUS = {
  invalid_endpoint: 400,
  invalid_query: 400,
  network: 502,
  timeout: 504,
  graphql: 400,
  graphql_partial: 200,
  size_limit: 413,
  page_limit: 422,
  row_limit: 422,
  path_error: 422,
  cancelled: 200,
};

/**
 * Resolve variables for a query run.
 * Returns { variables_base, error } where variables_base excludes pagination vars.
 */
function resolveVariables(queryDef, startDate, endDate, overrides) {
  let varDefs;
  try {
    varDefs = JSON.parse(queryDef.variable_defs);
  } catch (e) {
    return { variables_base: null, error: `Failed to parse variable_defs: ${e.message}` };
  }

  const variables = {};
  const PAGINATION_SOURCES = new Set(['pagination_first', 'pagination_skip', 'pagination_after']);

  for (const def of varDefs) {
    if (PAGINATION_SOURCES.has(def.source)) {
      // Pagination vars are injected by ponder.js, not here
      continue;
    }

    if (def.source === 'global_start') {
      if (startDate) {
        const date = new Date(startDate);
        if (queryDef.date_format === 'unix_seconds') {
          variables[def.name] = Math.floor(date.getTime() / 1000);
        } else if (queryDef.date_format === 'unix_ms') {
          variables[def.name] = date.getTime();
        } else {
          variables[def.name] = date.toISOString();
        }
      }
    } else if (def.source === 'global_end') {
      if (endDate) {
        const date = new Date(endDate);
        if (queryDef.date_format === 'unix_seconds') {
          variables[def.name] = Math.floor(date.getTime() / 1000);
        } else if (queryDef.date_format === 'unix_ms') {
          variables[def.name] = date.getTime();
        } else {
          variables[def.name] = date.toISOString();
        }
      }
    } else if (def.source === 'user' || def.source === 'none') {
      if (def.default !== undefined) {
        variables[def.name] = def.default;
      }
    }
  }

  // Apply user overrides
  if (overrides && typeof overrides === 'object') {
    Object.assign(variables, overrides);
  }

  return { variables_base: variables, error: null };
}

module.exports = function runsRoutes(db) {
  // Fresh router per invocation — avoids shared-handler pollution in tests
  const router = express.Router();

  // POST /api/runs
  router.post('/', async (req, res) => {
    const { query_id, endpoint: reqEndpoint, start_date, end_date, variable_overrides } = req.body || {};

    // Validate query exists
    if (!query_id) {
      return res.status(400).json({
        id: null, query_id: null, error_type: 'invalid_query',
        error_message: 'query_id is required.', rows: null,
        row_count: 0, page_count: 0, duration_ms: 0, warnings: [],
      });
    }

    const queryDef = db.prepare('SELECT * FROM queries WHERE id = ?').get(query_id);
    if (!queryDef) {
      return res.status(400).json({
        id: null, query_id, error_type: 'invalid_query',
        error_message: `Query with id ${query_id} not found.`, rows: null,
        row_count: 0, page_count: 0, duration_ms: 0, warnings: [],
      });
    }

    // Determine endpoint
    let endpoint = reqEndpoint;
    if (!endpoint) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'endpoint'").get();
      endpoint = row ? row.value : '';
    }

    if (!endpoint) {
      return res.status(400).json({
        id: null, query_id, error_type: 'invalid_endpoint',
        error_message: 'No endpoint configured.', rows: null,
        row_count: 0, page_count: 0, duration_ms: 0, warnings: [],
      });
    }

    // Validate endpoint
    const endpointError = await validateUrl(endpoint);
    if (endpointError) {
      return res.status(400).json({
        id: null, query_id, error_type: 'invalid_endpoint',
        error_message: endpointError, rows: null,
        row_count: 0, page_count: 0, duration_ms: 0, warnings: [],
      });
    }

    // Resolve variables
    const { variables_base, error: varError } = resolveVariables(
      queryDef, start_date, end_date, variable_overrides
    );
    if (varError) {
      return res.status(400).json({
        id: null, query_id, error_type: 'invalid_query',
        error_message: varError, rows: null,
        row_count: 0, page_count: 0, duration_ms: 0, warnings: [],
      });
    }

    // Auto-inject timestamp where-clause when no date variable_defs are configured.
    // If the injected query returns a GraphQL error we retry with the original GQL.
    let gqlToRun = queryDef.gql;
    let varsToRun = variables_base;
    let autoInjected = false;

    if (start_date || end_date) {
      let parsedVarDefs = [];
      try { parsedVarDefs = JSON.parse(queryDef.variable_defs || '[]'); } catch {}
      const hasDateSources = parsedVarDefs.some(
        d => d.source === 'global_start' || d.source === 'global_end'
      );
      if (!hasDateSources) {
        const inj = autoInjectDateFilter(
          queryDef.gql, start_date, end_date, queryDef.date_format
        );
        if (inj.injected) {
          gqlToRun    = inj.gql;
          varsToRun   = { ...variables_base, ...inj.extraVars };
          autoInjected = true;
        }
      }
    }

    // Fetch settings
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    // Set up AbortController for this request
    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.headersSent) {
        abortController.abort();
      }
    });

    const ranAt = new Date().toISOString();

    // Execute pagination
    let result = await fetchAllPages(
      endpoint,
      gqlToRun,
      varsToRun,
      queryDef,
      settings,
      abortController.signal
    );

    // If auto-injection caused a GraphQL error, retry with the original query.
    // This handles endpoints that don't support timestamp_gte / timestamp_lte filters.
    if (autoInjected && result.error_type === 'graphql' && !abortController.signal.aborted) {
      const fallback = await fetchAllPages(
        endpoint, queryDef.gql, variables_base, queryDef, settings, abortController.signal
      );
      result = {
        ...fallback,
        warnings: [
          'Auto date filter injection failed — your endpoint may not support ' +
          'timestamp_gte / timestamp_lte filters. Returning unfiltered results. ' +
          'To apply server-side date filtering, configure variable_defs with ' +
          'source: "global_start" / "global_end".',
          ...(fallback.warnings || []),
        ],
      };
    }

    const {
      rows, page_count, duration_ms, warnings,
      error_type, error_message, graphql_errors,
    } = result;

    // Build run record
    const runRecord = {
      id: null,
      query_id,
      endpoint,
      start_date: start_date || null,
      end_date: end_date || null,
      variables_base,
      // gql_used / variables_used: the actual query and variables sent to the endpoint
      // (may differ from queryDef.gql / variables_base when auto date-filter injection
      // rewrote the query and added timestamp_gte / timestamp_lte). Not persisted to DB.
      gql_used: gqlToRun,
      variables_used: varsToRun,
      rows,
      row_count: rows ? rows.length : 0,
      page_count,
      duration_ms,
      error_type: error_type || null,
      error_message: error_message || null,
      graphql_errors: graphql_errors || null,
      warnings: warnings || [],
      ran_at: ranAt,
    };

    // Only persist successful runs (null or graphql_partial)
    if (error_type === null || error_type === 'graphql_partial') {
      const rowsJson = JSON.stringify(rows);
      try {
        const stmt = db.prepare(`
          INSERT INTO runs (query_id, endpoint, start_date, end_date, variables_base, rows,
            row_count, page_count, duration_ms, error_type, error_message, graphql_errors,
            warnings, ran_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
          query_id, endpoint,
          start_date || null, end_date || null,
          JSON.stringify(variables_base),
          rowsJson,
          rows ? rows.length : 0,
          page_count, duration_ms,
          error_type || null, error_message || null,
          graphql_errors ? JSON.stringify(graphql_errors) : null,
          JSON.stringify(warnings || []),
          ranAt
        );
        runRecord.id = info.lastInsertRowid;
      } catch (e) {
        console.error('Failed to save run:', e);
        // Mark the run record so the client knows it wasn't persisted —
        // history won't show this run, but the result data is still returned.
        runRecord.db_save_failed = true;
      }
    }

    const httpStatus = ERROR_STATUS[error_type] || (error_type ? 400 : 200);
    res.status(httpStatus).json(runRecord);
  });

  // GET /api/runs?query_id=N&limit=20&offset=0
  router.get('/', (req, res) => {
    const { query_id, limit = 20, offset = 0 } = req.query;

    try {
      const limitN  = Math.max(0, parseInt(limit,  10) || 20);
      const offsetN = Math.max(0, parseInt(offset, 10) || 0);

      let query, params;
      if (query_id) {
        query = 'SELECT * FROM runs WHERE query_id = ? ORDER BY ran_at DESC LIMIT ? OFFSET ?';
        params = [query_id, limitN, offsetN];
      } else {
        query = 'SELECT * FROM runs ORDER BY ran_at DESC LIMIT ? OFFSET ?';
        params = [limitN, offsetN];
      }

      const rows = db.prepare(query).all(...params);
      const runs = rows.map(row => {
        let parsedWarnings = [], parsedGraphqlErrors = null, parsedVarsBase = {};
        try { parsedWarnings = JSON.parse(row.warnings || '[]'); } catch (e) {}
        try { parsedGraphqlErrors = row.graphql_errors ? JSON.parse(row.graphql_errors) : null; } catch (e) {}
        try { parsedVarsBase = JSON.parse(row.variables_base || '{}'); } catch (e) {}
        return {
          ...row,
          rows: undefined, // Exclude rows from list endpoint
          variables_base: parsedVarsBase,
          warnings: parsedWarnings,
          graphql_errors: parsedGraphqlErrors,
        };
      });
      res.json(runs);
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // GET /api/runs/:id
  router.get('/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'not_found', message: 'Run not found.' });

      let parsedRows = null, parsedWarnings = [], parsedGraphqlErrors = null, parsedVarsBase = {};

      try {
        parsedRows = row.rows ? JSON.parse(row.rows) : null;
      } catch (e) {
        console.error(`invalid_persisted_json: runs.rows for id=${row.id}`, e);
        return res.status(500).json({
          error: 'invalid_persisted_json',
          message: `Failed to parse rows for run ${row.id}`,
          id: row.id,
        });
      }
      try { parsedWarnings = JSON.parse(row.warnings || '[]'); } catch (e) {}
      try { parsedGraphqlErrors = row.graphql_errors ? JSON.parse(row.graphql_errors) : null; } catch (e) {}
      try { parsedVarsBase = JSON.parse(row.variables_base || '{}'); } catch (e) {}

      res.json({
        ...row,
        rows: parsedRows,
        variables_base: parsedVarsBase,
        warnings: parsedWarnings,
        graphql_errors: parsedGraphqlErrors,
      });
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // PATCH /api/runs/:id — update notes
  router.patch('/:id', (req, res) => {
    const { notes } = req.body || {};
    if (notes !== undefined && typeof notes !== 'string' && notes !== null) {
      return res.status(400).json({ error: 'validation_error', message: 'notes must be a string or null.' });
    }
    try {
      const existing = db.prepare('SELECT id FROM runs WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Run not found.' });
      db.prepare('UPDATE runs SET notes = ? WHERE id = ?').run(notes ?? null, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  // DELETE /api/runs/:id
  router.delete('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM runs WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Run not found.' });
      db.prepare('DELETE FROM runs WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      serverError(res, e, 'db_error');
    }
  });

  return router;
};
