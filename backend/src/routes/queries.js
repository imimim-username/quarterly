'use strict';

const express = require('express');

const REQUIRED_FIELDS = ['name', 'gql', 'result_path'];
const VALID_PAGINATION = ['offset', 'cursor', 'none'];
const VALID_DATE_FORMAT = ['unix_seconds', 'unix_ms', 'iso8601'];
const VALID_CHAIN_MODE = ['variable', 'filter', 'none'];

function validateQueryBody(body) {
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || typeof body[field] !== 'string' || body[field].trim() === '') {
      return `Field "${field}" is required and must be a non-empty string.`;
    }
  }

  if (body.pagination_style && !VALID_PAGINATION.includes(body.pagination_style)) {
    return `pagination_style must be one of: ${VALID_PAGINATION.join(', ')}`;
  }

  if (body.date_format && !VALID_DATE_FORMAT.includes(body.date_format)) {
    return `date_format must be one of: ${VALID_DATE_FORMAT.join(', ')}`;
  }

  if (body.chain_mode && !VALID_CHAIN_MODE.includes(body.chain_mode)) {
    return `chain_mode must be one of: ${VALID_CHAIN_MODE.join(', ')}`;
  }

  // cursor pagination requires cursor_path and has_next_path
  if (body.pagination_style === 'cursor') {
    if (!body.cursor_path || body.cursor_path.trim() === '') {
      return 'cursor_path is required when pagination_style is "cursor".';
    }
    if (!body.has_next_path || body.has_next_path.trim() === '') {
      return 'has_next_path is required when pagination_style is "cursor".';
    }
  }

  // Validate JSON fields — accept either a JSON string or an already-parsed value
  if (body.variable_defs !== undefined) {
    try {
      const raw = typeof body.variable_defs === 'string' ? body.variable_defs : JSON.stringify(body.variable_defs);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return 'variable_defs must be a JSON array.';
    } catch (e) {
      return 'variable_defs must be valid JSON.';
    }
  }

  if (body.field_meta !== undefined) {
    try {
      const raw = typeof body.field_meta === 'string' ? body.field_meta : JSON.stringify(body.field_meta);
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return 'field_meta must be a JSON object.';
    } catch (e) {
      return 'field_meta must be valid JSON.';
    }
  }

  if (body.computed_columns !== undefined) {
    try {
      const raw = typeof body.computed_columns === 'string' ? body.computed_columns : JSON.stringify(body.computed_columns);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return 'computed_columns must be a JSON array.';
    } catch (e) {
      return 'computed_columns must be valid JSON.';
    }
  }

  return null;
}

function rowToQuery(row) {
  let variable_defs, field_meta, chart_views, computed_columns, timestamp_extraction;
  try {
    variable_defs = JSON.parse(row.variable_defs);
  } catch (e) {
    throw { status: 500, error: 'invalid_persisted_json', message: `Failed to parse variable_defs for query ${row.id}`, id: row.id };
  }
  try {
    field_meta = JSON.parse(row.field_meta);
  } catch (e) {
    throw { status: 500, error: 'invalid_persisted_json', message: `Failed to parse field_meta for query ${row.id}`, id: row.id };
  }
  try {
    chart_views = JSON.parse(row.chart_views || '[]');
  } catch (e) {
    chart_views = [];
  }
  try {
    computed_columns = JSON.parse(row.computed_columns || '[]');
  } catch (e) {
    computed_columns = [];
  }
  try {
    timestamp_extraction = row.timestamp_extraction ? JSON.parse(row.timestamp_extraction) : null;
  } catch (e) {
    timestamp_extraction = null;
  }
  return { ...row, variable_defs, field_meta, chart_views, computed_columns, timestamp_extraction };
}

module.exports = function queriesRoutes(db) {
  const router = express.Router();
  // GET /api/queries
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM queries ORDER BY category, name').all();
      const queries = rows.map(row => {
        try {
          return rowToQuery(row);
        } catch (e) {
          console.error('invalid_persisted_json', e);
          return res.status(500).json(e);
        }
      });
      // If any rowToQuery caused an early response, queries array may be incomplete
      if (res.headersSent) return;
      res.json(queries);
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // GET /api/queries/:id
  router.get('/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM queries WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'not_found', message: 'Query not found.' });
      try {
        res.json(rowToQuery(row));
      } catch (e) {
        console.error('invalid_persisted_json', e);
        res.status(500).json(e);
      }
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // POST /api/queries
  router.post('/', (req, res) => {
    // Check this isn't the /import sub-route (handled separately)
    const err = validateQueryBody(req.body);
    if (err) return res.status(400).json({ error: 'validation_error', message: err });

    const now = new Date().toISOString();
    const {
      name,
      description = '',
      category = 'General',
      gql,
      variable_defs = '[]',
      result_path,
      pagination_style = 'offset',
      cursor_path = '',
      has_next_path = '',
      date_format = 'unix_seconds',
      chain_mode = 'filter',
      chain_var_name = 'chain',
      chain_field = 'chain',
      field_meta = '{}',
      key_field = 'id',
      is_builtin = 0,
      chart_views = '[]',
      computed_columns = '[]',
      timestamp_extraction = null,
    } = req.body;

    const tsRaw = timestamp_extraction == null ? null
      : typeof timestamp_extraction === 'string' ? timestamp_extraction
      : JSON.stringify(timestamp_extraction);

    try {
      const stmt = db.prepare(`
        INSERT INTO queries (name, description, category, gql, variable_defs, result_path,
          pagination_style, cursor_path, has_next_path, date_format, chain_mode, chain_var_name,
          chain_field, field_meta, key_field, is_builtin, chart_views, computed_columns,
          timestamp_extraction, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        name, description, category, gql,
        typeof variable_defs === 'string' ? variable_defs : JSON.stringify(variable_defs),
        result_path, pagination_style, cursor_path, has_next_path, date_format,
        chain_mode, chain_var_name, chain_field,
        typeof field_meta === 'string' ? field_meta : JSON.stringify(field_meta),
        key_field, is_builtin ? 1 : 0,
        typeof chart_views === 'string' ? chart_views : JSON.stringify(chart_views),
        typeof computed_columns === 'string' ? computed_columns : JSON.stringify(computed_columns),
        tsRaw,
        now, now
      );
      const created = db.prepare('SELECT * FROM queries WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(rowToQuery(created));
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // PUT /api/queries/:id
  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM queries WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found', message: 'Query not found.' });

    // Merge existing with body for validation
    const merged = { ...existing, ...req.body };
    const err = validateQueryBody(merged);
    if (err) return res.status(400).json({ error: 'validation_error', message: err });

    const now = new Date().toISOString();
    const {
      name, description, category, gql, variable_defs, result_path,
      pagination_style, cursor_path, has_next_path, date_format,
      chain_mode, chain_var_name, chain_field, field_meta, key_field, is_builtin,
      chart_views, computed_columns, timestamp_extraction,
    } = merged;

    const tsRawPut = timestamp_extraction == null ? null
      : typeof timestamp_extraction === 'string' ? timestamp_extraction
      : JSON.stringify(timestamp_extraction);

    try {
      db.prepare(`
        UPDATE queries SET name=?, description=?, category=?, gql=?, variable_defs=?,
          result_path=?, pagination_style=?, cursor_path=?, has_next_path=?, date_format=?,
          chain_mode=?, chain_var_name=?, chain_field=?, field_meta=?, key_field=?,
          is_builtin=?, chart_views=?, computed_columns=?, timestamp_extraction=?, updated_at=?
        WHERE id=?
      `).run(
        name, description, category, gql,
        typeof variable_defs === 'string' ? variable_defs : JSON.stringify(variable_defs),
        result_path, pagination_style, cursor_path, has_next_path, date_format,
        chain_mode, chain_var_name, chain_field,
        typeof field_meta === 'string' ? field_meta : JSON.stringify(field_meta),
        key_field, is_builtin ? 1 : 0,
        typeof chart_views === 'string' ? chart_views : JSON.stringify(chart_views || []),
        typeof computed_columns === 'string' ? computed_columns : JSON.stringify(computed_columns || []),
        tsRawPut,
        now,
        req.params.id
      );
      const updated = db.prepare('SELECT * FROM queries WHERE id = ?').get(req.params.id);
      res.json(rowToQuery(updated));
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // DELETE /api/queries/:id
  router.delete('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM queries WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found', message: 'Query not found.' });
      db.prepare('DELETE FROM queries WHERE id = ?').run(req.params.id);
      res.status(204).end();
    } catch (e) {
      if (e.message && e.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(409).json({
          error: 'constraint_error',
          message: 'This query is used by one or more reports. Remove it from all reports before deleting.',
        });
      }
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  // POST /api/queries/import — bulk import
  router.post('/import', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'bad_request', message: 'Body must be a JSON array.' });
    }

    const now = new Date().toISOString();
    const results = [];

    const importMany = db.transaction(() => {
      for (const item of items) {
        const isBuiltin = item.is_builtin ? 1 : 0;
        const name = item.name;

        const existing = db.prepare('SELECT id, is_builtin FROM queries WHERE name = ?').get(name);

        if (existing && isBuiltin) {
          // Built-in: skip if already exists (preserve user edits)
          results.push({ name, action: 'skipped', id: existing.id });
          continue;
        }

        if (existing && !isBuiltin) {
          // Non-builtin: upsert by name
          db.prepare(`
            UPDATE queries SET description=?, category=?, gql=?, variable_defs=?,
              result_path=?, pagination_style=?, cursor_path=?, has_next_path=?,
              date_format=?, chain_mode=?, chain_var_name=?, chain_field=?,
              field_meta=?, key_field=?, is_builtin=?, computed_columns=?, updated_at=?
            WHERE name=?
          `).run(
            item.description || '', item.category || 'General', item.gql,
            typeof item.variable_defs === 'string' ? item.variable_defs : JSON.stringify(item.variable_defs || []),
            item.result_path, item.pagination_style || 'offset',
            item.cursor_path || '', item.has_next_path || '',
            item.date_format || 'unix_seconds', item.chain_mode || 'filter',
            item.chain_var_name || 'chain', item.chain_field || 'chain',
            typeof item.field_meta === 'string' ? item.field_meta : JSON.stringify(item.field_meta || {}),
            item.key_field || 'id', isBuiltin,
            typeof item.computed_columns === 'string' ? item.computed_columns : JSON.stringify(item.computed_columns || []),
            now,
            name
          );
          results.push({ name, action: 'updated', id: existing.id });
          continue;
        }

        // Insert new
        const stmt = db.prepare(`
          INSERT INTO queries (name, description, category, gql, variable_defs, result_path,
            pagination_style, cursor_path, has_next_path, date_format, chain_mode, chain_var_name,
            chain_field, field_meta, key_field, is_builtin, computed_columns, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
          name, item.description || '', item.category || 'General', item.gql,
          typeof item.variable_defs === 'string' ? item.variable_defs : JSON.stringify(item.variable_defs || []),
          item.result_path, item.pagination_style || 'offset',
          item.cursor_path || '', item.has_next_path || '',
          item.date_format || 'unix_seconds', item.chain_mode || 'filter',
          item.chain_var_name || 'chain', item.chain_field || 'chain',
          typeof item.field_meta === 'string' ? item.field_meta : JSON.stringify(item.field_meta || {}),
          item.key_field || 'id', isBuiltin,
          typeof item.computed_columns === 'string' ? item.computed_columns : JSON.stringify(item.computed_columns || []),
          now, now
        );
        results.push({ name, action: 'created', id: info.lastInsertRowid });
      }
    });

    try {
      importMany();
      res.json({ imported: results.length, results });
    } catch (e) {
      res.status(500).json({ error: 'db_error', message: e.message });
    }
  });

  return router;
};
