'use strict';

const express = require('express');
const archiver = require('archiver');
const { toJson, toCsv } = require('../export');

const router = express.Router();

function parseRunRows(row) {
  let rows = null;
  let fieldMeta = {};
  let keyField = 'id';

  try {
    rows = row.rows ? JSON.parse(row.rows) : null;
  } catch (e) {
    console.error(`invalid_persisted_json: runs.rows for id=${row.id}`, e);
    throw { status: 500, error: 'invalid_persisted_json', message: `Failed to parse rows for run ${row.id}`, id: row.id };
  }

  return { rows, fieldMeta, keyField };
}

module.exports = function exportRoutes(db) {
  // GET /api/export/run/:id/json
  router.get('/run/:id/json', (req, res) => {
    try {
      const run = db.prepare('SELECT r.*, q.field_meta, q.key_field FROM runs r JOIN queries q ON r.query_id = q.id WHERE r.id = ?').get(req.params.id);
      if (!run) return res.status(404).json({ error: 'not_found', message: 'Run not found.' });

      let rows;
      try {
        rows = run.rows ? JSON.parse(run.rows) : [];
      } catch (e) {
        console.error(`invalid_persisted_json: runs.rows for id=${run.id}`, e);
        return res.status(500).json({ error: 'invalid_persisted_json', message: `Failed to parse rows for run ${run.id}`, id: run.id });
      }

      const filename = `run_${run.id}_${run.ran_at.replace(/[:.]/g, '-')}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(toJson(rows));
    } catch (e) {
      if (e.status) return res.status(e.status).json(e);
      res.status(500).json({ error: 'server_error', message: e.message });
    }
  });

  // GET /api/export/run/:id/csv
  router.get('/run/:id/csv', (req, res) => {
    try {
      const run = db.prepare('SELECT r.*, q.field_meta, q.key_field FROM runs r JOIN queries q ON r.query_id = q.id WHERE r.id = ?').get(req.params.id);
      if (!run) return res.status(404).json({ error: 'not_found', message: 'Run not found.' });

      let rows, fieldMeta;
      try {
        rows = run.rows ? JSON.parse(run.rows) : [];
      } catch (e) {
        return res.status(500).json({ error: 'invalid_persisted_json', message: `Failed to parse rows for run ${run.id}`, id: run.id });
      }
      try {
        fieldMeta = run.field_meta ? JSON.parse(run.field_meta) : {};
      } catch (e) {
        fieldMeta = {};
      }

      const keyField = run.key_field || 'id';
      const csvContent = toCsv(rows, fieldMeta, keyField);
      const filename = `run_${run.id}_${run.ran_at.replace(/[:.]/g, '-')}.csv`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'text/csv');
      res.send(csvContent);
    } catch (e) {
      res.status(500).json({ error: 'server_error', message: e.message });
    }
  });

  // GET /api/export/report-run/:id/zip
  router.get('/report-run/:id/zip', async (req, res) => {
    try {
      const reportRun = db.prepare('SELECT * FROM report_runs WHERE id = ?').get(req.params.id);
      if (!reportRun) return res.status(404).json({ error: 'not_found', message: 'Report run not found.' });

      const queryStatuses = db.prepare(`
        SELECT rrq.query_id, rrq.run_id, rrq.status, q.name, q.field_meta, q.key_field
        FROM report_run_queries rrq
        JOIN queries q ON rrq.query_id = q.id
        WHERE rrq.report_run_id = ?
      `).all(req.params.id);

      const filename = `report_run_${reportRun.id}_${reportRun.ran_at.replace(/[:.]/g, '-')}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/zip');

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) res.status(500).end();
      });
      archive.pipe(res);

      for (const qs of queryStatuses) {
        if (!qs.run_id) continue;

        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(qs.run_id);
        if (!run) continue;

        let rows = [];
        try {
          rows = run.rows ? JSON.parse(run.rows) : [];
        } catch (e) {
          continue;
        }

        let fieldMeta = {};
        try { fieldMeta = qs.field_meta ? JSON.parse(qs.field_meta) : {}; } catch (e) {}

        const keyField = qs.key_field || 'id';
        const csvContent = toCsv(rows, fieldMeta, keyField);
        const safeName = (qs.name || `query_${qs.query_id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        archive.append(csvContent, { name: `${safeName}.csv` });
      }

      await archive.finalize();
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'server_error', message: e.message });
    }
  });

  return router;
};
