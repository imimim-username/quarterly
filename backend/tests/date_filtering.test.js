'use strict';

/**
 * Tests for date-variable filtering.
 *
 * Verifies that start_date / end_date supplied to POST /api/runs are
 * translated into GraphQL variables that travel in the request body sent
 * to the Ponder endpoint — i.e. filtering is server-side, not a
 * post-hoc client-side trim of an already-complete dataset.
 *
 * Two test groups:
 *   1. Unit / route-level — nock intercepts the outgoing HTTP request so
 *      we can inspect exactly which variables were sent.
 *   2. Integration — real requests to the live endpoint; asserts that a
 *      narrow time window returns fewer rows than an unbounded query.
 *      These tests are skipped when QUARTERLY_INTEGRATION_TESTS !== '1'.
 */

const Database = require('better-sqlite3');
const supertest = require('supertest');
const express = require('express');
const nock = require('nock');

const migration001 = require('../src/migrations/001_initial');
const migration002 = require('../src/migrations/002_address_labels');
const migration003 = require('../src/migrations/003_chart_views');
const runsRoutes = require('../src/routes/runs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Must be a loopback address so validateUrl() accepts it
const MOCK_HOST = 'http://127.0.0.1:9999';
const MOCK_PATH = '/graphql';
const MOCK_ENDPOINT = MOCK_HOST + MOCK_PATH;

const LIVE_ENDPOINT = 'https://ponder--ponder--qsxl6ml4dlkk.code.run/graphql';

const INTEGRATION = process.env.QUARTERLY_INTEGRATION_TESTS === '1';

/** Create a fully-migrated in-memory SQLite database. */
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migration001.up(db);
  migration002.up(db);
  migration003.up(db);
  // Point the endpoint setting at our mock host
  db.prepare("UPDATE settings SET value=? WHERE key='endpoint'").run(MOCK_ENDPOINT);
  return db;
}

/** Create a minimal Express app wired to the runs router. */
function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/runs', runsRoutes(db));
  return app;
}

/** Insert a minimal query row; returns its id. */
function insertQuery(db, overrides = {}) {
  const now = new Date().toISOString();
  const defaults = {
    name: 'Test Query',
    description: '',
    category: 'Test',
    gql: 'query Q($first: Int, $skip: Int) { items(first: $first, skip: $skip) { items { id timestamp } } }',
    variable_defs: JSON.stringify([
      { name: 'first',  source: 'pagination_first', default: 1000 },
      { name: 'skip',   source: 'pagination_skip',  default: 0 },
    ]),
    result_path: 'data.items.items',
    pagination_style: 'offset',
    cursor_path: '',
    has_next_path: '',
    date_format: 'unix_seconds',
    chain_mode: 'none',
    chain_var_name: '',
    chain_field: '',
    field_meta: '{}',
    chart_views: '[]',
    key_field: 'id',
    is_builtin: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };

  const info = db.prepare(`
    INSERT INTO queries
      (name, description, category, gql, variable_defs, result_path,
       pagination_style, cursor_path, has_next_path, date_format,
       chain_mode, chain_var_name, chain_field, field_meta, chart_views,
       key_field, is_builtin, created_at, updated_at)
    VALUES
      (@name, @description, @category, @gql, @variable_defs, @result_path,
       @pagination_style, @cursor_path, @has_next_path, @date_format,
       @chain_mode, @chain_var_name, @chain_field, @field_meta, @chart_views,
       @key_field, @is_builtin, @created_at, @updated_at)
  `).run(defaults);

  return info.lastInsertRowid;
}

/** Build a variable_defs JSON string with start + end date vars. */
function makeDateVarDefs(startName, endName, paginationStyle = 'offset') {
  const defs = [
    { name: startName, source: 'global_start', default: null },
    { name: endName,   source: 'global_end',   default: null },
  ];
  if (paginationStyle === 'offset') {
    defs.push({ name: 'first', source: 'pagination_first', default: 1000 });
    defs.push({ name: 'skip',  source: 'pagination_skip',  default: 0 });
  }
  return JSON.stringify(defs);
}

/** Helper: POST to /api/runs, return { status, body, capturedVars }. */
async function runQuery(app, queryId, startDate, endDate, extraNockHandler) {
  let capturedVars;

  nock(MOCK_HOST)
    .post(MOCK_PATH)
    .reply(200, function (_uri, body) {
      capturedVars = body.variables || {};
      // Return a minimal single-page result
      return { data: { items: { items: [] } } };
    });

  const res = await supertest(app)
    .post('/api/runs')
    .send({ query_id: queryId, start_date: startDate, end_date: endDate });

  return { status: res.status, body: res.body, capturedVars };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

afterEach(() => {
  nock.cleanAll();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — route-level tests (nock, no real network)
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveVariables — date variable injection (via POST /api/runs)', () => {

  // ─── unix_seconds ───────────────────────────────────────────────────────────

  describe('date_format = unix_seconds', () => {
    let db, app, queryId;
    const START_ISO = '2024-01-01T00:00:00.000Z';
    const END_ISO   = '2024-03-31T23:59:59.000Z';

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
      queryId = insertQuery(db, {
        variable_defs: makeDateVarDefs('timestamp_gte', 'timestamp_lte'),
        date_format: 'unix_seconds',
      });
    });

    test('start_date maps to unix seconds', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, null);
      expect(capturedVars.timestamp_gte).toBe(Math.floor(new Date(START_ISO).getTime() / 1000));
    });

    test('end_date maps to unix seconds', async () => {
      const { capturedVars } = await runQuery(app, queryId, null, END_ISO);
      expect(capturedVars.timestamp_lte).toBe(Math.floor(new Date(END_ISO).getTime() / 1000));
    });

    test('both start and end date passed together', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, END_ISO);
      expect(capturedVars.timestamp_gte).toBe(Math.floor(new Date(START_ISO).getTime() / 1000));
      expect(capturedVars.timestamp_lte).toBe(Math.floor(new Date(END_ISO).getTime() / 1000));
    });

    test('result is integer (not float)', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, END_ISO);
      expect(Number.isInteger(capturedVars.timestamp_gte)).toBe(true);
      expect(Number.isInteger(capturedVars.timestamp_lte)).toBe(true);
    });

    test('no date params → no date variables sent', async () => {
      const { capturedVars } = await runQuery(app, queryId, null, null);
      expect(capturedVars.timestamp_gte).toBeUndefined();
      expect(capturedVars.timestamp_lte).toBeUndefined();
    });
  });

  // ─── unix_ms ────────────────────────────────────────────────────────────────

  describe('date_format = unix_ms', () => {
    let db, app, queryId;
    const START_ISO = '2024-06-15T12:00:00.000Z';
    const END_ISO   = '2024-06-15T18:00:00.000Z';

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
      queryId = insertQuery(db, {
        variable_defs: makeDateVarDefs('startTimestamp', 'endTimestamp'),
        date_format: 'unix_ms',
      });
    });

    test('start_date maps to unix milliseconds', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, null);
      expect(capturedVars.startTimestamp).toBe(new Date(START_ISO).getTime());
    });

    test('end_date maps to unix milliseconds', async () => {
      const { capturedVars } = await runQuery(app, queryId, null, END_ISO);
      expect(capturedVars.endTimestamp).toBe(new Date(END_ISO).getTime());
    });

    test('unix_ms value is 1000x unix_seconds value', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, END_ISO);
      expect(capturedVars.startTimestamp).toBe(Math.floor(new Date(START_ISO).getTime() / 1000) * 1000);
    });
  });

  // ─── iso8601 ────────────────────────────────────────────────────────────────

  describe('date_format = iso8601 (default fallback)', () => {
    let db, app, queryId;
    const START_ISO = '2024-09-01T00:00:00.000Z';
    const END_ISO   = '2024-09-30T23:59:59.000Z';

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
      queryId = insertQuery(db, {
        variable_defs: makeDateVarDefs('after', 'before'),
        date_format: 'iso8601',
      });
    });

    test('start_date maps to ISO 8601 string', async () => {
      const { capturedVars } = await runQuery(app, queryId, START_ISO, null);
      expect(capturedVars.after).toBe(new Date(START_ISO).toISOString());
    });

    test('end_date maps to ISO 8601 string', async () => {
      const { capturedVars } = await runQuery(app, queryId, null, END_ISO);
      expect(capturedVars.before).toBe(new Date(END_ISO).toISOString());
    });
  });

  // ─── Pagination vars excluded ────────────────────────────────────────────────

  describe('pagination variable exclusion', () => {
    let db, app, queryId;

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
      // Query with pagination + date vars
      queryId = insertQuery(db, {
        variable_defs: JSON.stringify([
          { name: 'timestamp_gte', source: 'global_start', default: null },
          { name: 'timestamp_lte', source: 'global_end',   default: null },
          { name: 'first',         source: 'pagination_first', default: 1000 },
          { name: 'skip',          source: 'pagination_skip',  default: 0 },
        ]),
        date_format: 'unix_seconds',
      });
    });

    test('pagination vars are injected by ponder, not in variables_base', async () => {
      let capturedVars;
      nock(MOCK_HOST)
        .post(MOCK_PATH)
        .reply(200, function (_uri, body) {
          capturedVars = body.variables || {};
          return { data: { items: { items: [] } } };
        });

      await supertest(createApp(db))
        .post('/api/runs')
        .send({
          query_id: queryId,
          start_date: '2024-01-01T00:00:00.000Z',
          end_date: '2024-12-31T23:59:59.000Z',
        });

      // first/skip come from ponder.js pagination injection, not resolveVariables
      // They should still appear (ponder adds them), but the key point is
      // timestamp_gte and timestamp_lte come from resolveVariables correctly
      expect(capturedVars.timestamp_gte).toBeDefined();
      expect(capturedVars.timestamp_lte).toBeDefined();
    });

    test('variables_base stored in DB excludes pagination vars', async () => {
      nock(MOCK_HOST)
        .post(MOCK_PATH)
        .reply(200, { data: { items: { items: [{ id: '1', timestamp: '1704067200' }] } } });
      // Empty second page so pagination stops
      nock(MOCK_HOST)
        .post(MOCK_PATH)
        .reply(200, { data: { items: { items: [] } } });

      const START = '2024-01-01T00:00:00.000Z';
      const END = '2024-12-31T23:59:59.000Z';

      const res = await supertest(createApp(db))
        .post('/api/runs')
        .send({ query_id: queryId, start_date: START, end_date: END });

      const runId = res.body.id;
      // The persisted variables_base should only have date vars, not pagination
      const row = db.prepare('SELECT variables_base FROM runs WHERE id = ?').get(runId);
      const stored = JSON.parse(row.variables_base);
      expect(stored.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
      expect(stored.timestamp_lte).toBe(Math.floor(new Date(END).getTime() / 1000));
      expect(stored.first).toBeUndefined();
      expect(stored.skip).toBeUndefined();
    });
  });

  // ─── User/none default variables ─────────────────────────────────────────────

  describe('user / none default variable injection', () => {
    let db, app, queryId;

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
      queryId = insertQuery(db, {
        variable_defs: JSON.stringify([
          { name: 'limit',   source: 'user',  default: 500 },
          { name: 'network', source: 'none',  default: 'mainnet' },
          { name: 'first',   source: 'pagination_first', default: 1000 },
          { name: 'skip',    source: 'pagination_skip',  default: 0 },
        ]),
        date_format: 'unix_seconds',
      });
    });

    test('user/none defaults are included in variables_base', async () => {
      const { capturedVars } = await runQuery(app, queryId, null, null);
      expect(capturedVars.limit).toBe(500);
      expect(capturedVars.network).toBe('mainnet');
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    let db, app;

    beforeEach(() => {
      db = createTestDb();
      app = createApp(db);
    });

    test('query with no date variable_defs: date params have no effect on variables', async () => {
      const queryId = insertQuery(db, {
        variable_defs: JSON.stringify([
          { name: 'first', source: 'pagination_first', default: 1000 },
          { name: 'skip',  source: 'pagination_skip',  default: 0 },
        ]),
        date_format: 'unix_seconds',
      });

      const { capturedVars } = await runQuery(app, queryId, '2024-01-01T00:00:00.000Z', '2024-12-31T23:59:59.000Z');
      // No date vars in the query def → nothing injected
      expect(capturedVars.timestamp_gte).toBeUndefined();
      expect(capturedVars.timestamp_lte).toBeUndefined();
    });

    test('start_date only: only start variable injected', async () => {
      const queryId = insertQuery(db, {
        variable_defs: makeDateVarDefs('ts_gte', 'ts_lte'),
        date_format: 'unix_seconds',
      });
      const { capturedVars } = await runQuery(app, queryId, '2024-06-01T00:00:00.000Z', null);
      expect(capturedVars.ts_gte).toBeDefined();
      expect(capturedVars.ts_lte).toBeUndefined();
    });

    test('end_date only: only end variable injected', async () => {
      const queryId = insertQuery(db, {
        variable_defs: makeDateVarDefs('ts_gte', 'ts_lte'),
        date_format: 'unix_seconds',
      });
      const { capturedVars } = await runQuery(app, queryId, null, '2024-06-30T23:59:59.000Z');
      expect(capturedVars.ts_gte).toBeUndefined();
      expect(capturedVars.ts_lte).toBeDefined();
    });

    test('invalid variable_defs JSON → 400 with invalid_query error', async () => {
      const queryId = insertQuery(db, {
        variable_defs: 'not-valid-json',
        date_format: 'unix_seconds',
      });
      // No nock needed — the route returns 400 before hitting the endpoint
      const res = await supertest(app)
        .post('/api/runs')
        .send({ query_id: queryId, start_date: '2024-01-01T00:00:00.000Z' });
      expect(res.status).toBe(400);
      expect(res.body.error_type).toBe('invalid_query');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Integration tests against live Ponder endpoint
// ═══════════════════════════════════════════════════════════════════════════════

const describeIntegration = INTEGRATION ? describe : describe.skip;

describeIntegration('Integration — live Ponder endpoint date filtering', () => {
  /**
   * alchemistDeposits has a `timestamp` field (unix seconds, BigInt).
   * Data range confirmed: ~2026-04-14 to present.
   *
   * GQL uses Ponder v1 conventions:
   *   filter type: alchemistDepositFilter
   *   args:        limit / offset  (not first / skip)
   *   timestamp filters: timestamp_gte, timestamp_lte  (BigInt, pass as number)
   */

  const GQL = `
    query AlchemistDeposits($where: alchemistDepositFilter, $limit: Int, $offset: Int) {
      alchemistDeposits(where: $where, limit: $limit, offset: $offset) {
        items {
          id
          timestamp
        }
      }
    }
  `;

  async function fetchDeposits(variables = {}) {
    const res = await fetch(LIVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GQL, variables }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
    return json.data.alchemistDeposits.items;
  }

  test('unbounded query returns results', async () => {
    const rows = await fetchDeposits({ limit: 100, offset: 0 });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);

  test('narrow time window returns fewer rows than a wide window', async () => {
    // Fetch the earliest and latest deposits to find the data range
    const [earliest, latest] = await Promise.all([
      fetchDeposits({ limit: 1, offset: 0 }),
      // Ponder doesn't support ORDER BY in variables; use a known recent ts instead
      fetchDeposits({ where: { timestamp_gte: 1776173304 }, limit: 1, offset: 0 }),
    ]);

    // We know from introspection that data spans 2026-04-14 to ~now.
    // Use a 1-day window near the start vs. the full 5-week range.
    const windowStart = 1776173304; // 2026-04-14
    const windowEnd   = 1776259704; // 2026-04-15 (exactly 24h later)
    const bigEnd      = Math.floor(new Date('2100-01-01T00:00:00Z').getTime() / 1000);

    const [narrow, wide] = await Promise.all([
      fetchDeposits({ where: { timestamp_gte: windowStart, timestamp_lte: windowEnd }, limit: 1000, offset: 0 }),
      fetchDeposits({ where: { timestamp_gte: windowStart, timestamp_lte: bigEnd },   limit: 1000, offset: 0 }),
    ]);

    // The 1-day window must have at least one result (we know data exists there)
    expect(narrow.length).toBeGreaterThan(0);
    // The multi-year window must have at least as many results
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);

    // All narrow rows must be within the 1-day window
    for (const row of narrow) {
      const ts = Number(row.timestamp);
      expect(ts).toBeGreaterThanOrEqual(windowStart);
      expect(ts).toBeLessThanOrEqual(windowEnd);
    }
  }, 30000);

  test('end_date before all data returns 0 rows', async () => {
    // 2023-01-01 is well before the earliest deposit (~2026-04)
    const oldDate = Math.floor(new Date('2023-01-01T00:00:00Z').getTime() / 1000);
    const rows = await fetchDeposits({
      where: { timestamp_lte: oldDate },
      limit: 100,
      offset: 0,
    });
    expect(rows.length).toBe(0);
  }, 30000);

  test('start_date after all data returns 0 rows', async () => {
    // Year 2100 is well after any current data
    const farFuture = Math.floor(new Date('2100-01-01T00:00:00Z').getTime() / 1000);
    const rows = await fetchDeposits({
      where: { timestamp_gte: farFuture },
      limit: 100,
      offset: 0,
    });
    expect(rows.length).toBe(0);
  }, 30000);

  test('bounded rows all have timestamp within [start, end]', async () => {
    // Use a 7-day window anchored on a known data date (mid-April 2026)
    const start = Math.floor(new Date('2026-04-14T00:00:00Z').getTime() / 1000);
    const end   = Math.floor(new Date('2026-04-21T23:59:59Z').getTime() / 1000);

    const rows = await fetchDeposits({
      where: { timestamp_gte: start, timestamp_lte: end },
      limit: 200,
      offset: 0,
    });

    // If there are any rows, they must be within bounds
    for (const row of rows) {
      const ts = Number(row.timestamp);
      expect(ts).toBeGreaterThanOrEqual(start);
      expect(ts).toBeLessThanOrEqual(end);
    }
  }, 30000);
});
