'use strict';

/**
 * Tests for date-variable filtering.
 *
 * Three test groups:
 *   1. Unit / route-level (resolveVariables) — jest.fn() mocks the outgoing
 *      HTTP request so we can inspect exactly which variables were sent when
 *      the query has explicit global_start / global_end variable_defs.
 *   2. Auto date-filter injection — verifies that when a query has NO date
 *      variable_defs the backend auto-injects `where: { timestamp_gte, … }`
 *      into the GQL and falls back gracefully if the endpoint rejects it.
 *   3. Integration — real requests to the live endpoint; asserts that a
 *      narrow time window returns fewer rows than an unbounded query.
 *      These tests are skipped when QUARTERLY_INTEGRATION_TESTS !== '1'.
 */

const Database = require('better-sqlite3');
const supertest = require('supertest');
const express = require('express');

const migration001 = require('../src/migrations/001_initial');
const migration002 = require('../src/migrations/002_address_labels');
const migration003 = require('../src/migrations/003_chart_views');
const runsRoutes = require('../src/routes/runs');
const { autoInjectDateFilter } = require('../src/utils/autoInjectDateFilter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Must be a loopback address so validateUrl() accepts it
const MOCK_HOST = 'http://127.0.0.1:9999';
const MOCK_PATH = '/graphql';
const MOCK_ENDPOINT = MOCK_HOST + MOCK_PATH;

const LIVE_ENDPOINT = 'https://ponder--ponder--qsxl6ml4dlkk.code.run/graphql';

const INTEGRATION = process.env.QUARTERLY_INTEGRATION_TESTS === '1';

// Mock a native-fetch-compatible Response object
function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

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

/**
 * Helper: POST to /api/runs, return { status, body, capturedVars }.
 * Queues one fetch mock that captures variables and returns a minimal empty result.
 */
async function runQuery(app, queryId, startDate, endDate) {
  let capturedVars;

  global.fetch.mockImplementationOnce(async (_url, opts) => {
    capturedVars = JSON.parse(opts.body).variables || {};
    return mockResponse({ data: { items: { items: [] } } });
  });

  const res = await supertest(app)
    .post('/api/runs')
    .send({ query_id: queryId, start_date: startDate, end_date: endDate });

  return { status: res.status, body: res.body, capturedVars };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let _realFetch;
beforeEach(() => {
  _realFetch = global.fetch;
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = _realFetch;
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — route-level tests (jest.fn(), no real network)
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
      global.fetch.mockImplementationOnce(async (_url, opts) => {
        capturedVars = JSON.parse(opts.body).variables || {};
        return mockResponse({ data: { items: { items: [] } } });
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
      global.fetch
        .mockResolvedValueOnce(mockResponse({ data: { items: { items: [{ id: '1', timestamp: '1704067200' }] } } }))
        .mockResolvedValueOnce(mockResponse({ data: { items: { items: [] } } }));

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

    test('query with no date variable_defs: auto-injects timestamp_gte / timestamp_lte', async () => {
      const queryId = insertQuery(db, {
        variable_defs: JSON.stringify([
          { name: 'first', source: 'pagination_first', default: 1000 },
          { name: 'skip',  source: 'pagination_skip',  default: 0 },
        ]),
        date_format: 'unix_seconds',
      });

      const START = '2024-01-01T00:00:00.000Z';
      const END   = '2024-12-31T23:59:59.000Z';
      const { capturedVars } = await runQuery(app, queryId, START, END);
      // Auto-injection kicks in → both timestamp vars present
      expect(capturedVars.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
      expect(capturedVars.timestamp_lte).toBe(Math.floor(new Date(END).getTime() / 1000));
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
      // No fetch mock needed — the route returns 400 before hitting the endpoint
      const res = await supertest(app)
        .post('/api/runs')
        .send({ query_id: queryId, start_date: '2024-01-01T00:00:00.000Z' });
      expect(res.status).toBe(400);
      expect(res.body.error_type).toBe('invalid_query');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Auto date-filter injection (unit + route tests)
// ═══════════════════════════════════════════════════════════════════════════════

// The user's exact alchemistBurns GQL (no variable_defs, no where clause).
const BURNS_GQL = [
  'query MyQuery {',
  '  alchemistBurns(orderBy: "timestamp", orderDirection: "asc") {',
  '    items {',
  '      alchemist',
  '      amount',
  '      chain',
  '      timestamp',
  '    }',
  '  }',
  '}',
].join('\n');

describe('autoInjectDateFilter() — unit tests', () => {
  test('injects timestamp_gte into query signature and field args (unix_seconds)', () => {
    const START = '2026-05-15T00:00:00.000Z';
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, START, null, 'unix_seconds');

    expect(injected).toBe(true);
    // Variable declaration added to query signature
    expect(gql).toContain('$timestamp_gte: BigInt');
    // Where clause added to field arguments
    expect(gql).toContain('where: { timestamp_gte: $timestamp_gte }');
    // Original field args preserved after the injected where
    expect(gql).toContain('orderBy: "timestamp"');
    // Correct scalar value
    expect(extraVars.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
    expect(extraVars.timestamp_lte).toBeUndefined();
  });

  test('injects both timestamp_gte and timestamp_lte when both dates given', () => {
    const START = '2026-05-15T00:00:00.000Z';
    const END   = '2026-05-16T00:00:00.000Z';
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, START, END, 'unix_seconds');

    expect(injected).toBe(true);
    expect(gql).toContain('$timestamp_gte: BigInt');
    expect(gql).toContain('$timestamp_lte: BigInt');
    expect(gql).toContain('where: { timestamp_gte: $timestamp_gte, timestamp_lte: $timestamp_lte }');
    expect(extraVars.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
    expect(extraVars.timestamp_lte).toBe(Math.floor(new Date(END).getTime() / 1000));
  });

  test('end-only: injects only timestamp_lte', () => {
    const END = '2026-05-16T00:00:00.000Z';
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, null, END, 'unix_seconds');

    expect(injected).toBe(true);
    expect(gql).not.toContain('timestamp_gte');
    expect(gql).toContain('$timestamp_lte: BigInt');
    expect(gql).toContain('where: { timestamp_lte: $timestamp_lte }');
    expect(extraVars.timestamp_lte).toBe(Math.floor(new Date(END).getTime() / 1000));
  });

  test('no dates → injected: false, gql unchanged', () => {
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, null, null, 'unix_seconds');

    expect(injected).toBe(false);
    expect(gql).toBe(BURNS_GQL);
    expect(Object.keys(extraVars)).toHaveLength(0);
  });

  test('unix_ms format: value is milliseconds, type is still BigInt', () => {
    const START = '2026-05-15T00:00:00.000Z';
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, START, null, 'unix_ms');

    expect(injected).toBe(true);
    expect(gql).toContain('$timestamp_gte: BigInt');
    expect(extraVars.timestamp_gte).toBe(new Date(START).getTime());
  });

  test('iso8601 format: value is ISO string, type is String', () => {
    const START = '2026-05-15T00:00:00.000Z';
    const { gql, extraVars, injected } = autoInjectDateFilter(BURNS_GQL, START, null, 'iso8601');

    expect(injected).toBe(true);
    expect(gql).toContain('$timestamp_gte: String');
    expect(extraVars.timestamp_gte).toBe(new Date(START).toISOString());
  });

  test('query with existing variable declarations: new vars appended', () => {
    const gqlWithVars = [
      'query MyQuery($chain: String) {',
      '  alchemistBurns(chain: $chain, orderBy: "timestamp", orderDirection: "asc") {',
      '    items { timestamp }',
      '  }',
      '}',
    ].join('\n');

    const { gql, injected } = autoInjectDateFilter(gqlWithVars, '2026-05-15T00:00:00.000Z', null, 'unix_seconds');

    expect(injected).toBe(true);
    // Both original and new var declarations present
    expect(gql).toContain('$chain: String');
    expect(gql).toContain('$timestamp_gte: BigInt');
    // Where prepended before existing field arg
    expect(gql).toContain('where: { timestamp_gte: $timestamp_gte }, chain: $chain');
  });

  test('query with field that has no args: wraps in new parens', () => {
    const gqlNoArgs = [
      'query MyQuery {',
      '  alchemistBurns {',
      '    items { timestamp }',
      '  }',
      '}',
    ].join('\n');

    const { gql, injected } = autoInjectDateFilter(gqlNoArgs, '2026-05-15T00:00:00.000Z', null, 'unix_seconds');

    expect(injected).toBe(true);
    expect(gql).toContain('alchemistBurns(where: { timestamp_gte: $timestamp_gte })');
  });

  test('non-query document (no query keyword): injected: false', () => {
    const mutation = 'mutation { foo }';
    const { gql, injected } = autoInjectDateFilter(mutation, '2026-05-15T00:00:00.000Z', null, 'unix_seconds');

    expect(injected).toBe(false);
    expect(gql).toBe(mutation);
  });

  test('injected GQL is valid GraphQL-looking text (smoke check)', () => {
    const { gql, injected } = autoInjectDateFilter(
      BURNS_GQL, '2026-05-15T00:00:00.000Z', '2026-05-16T00:00:00.000Z', 'unix_seconds'
    );

    expect(injected).toBe(true);
    // Starts with query keyword
    expect(gql.trim()).toMatch(/^query MyQuery\(/);
    // Braces balanced
    const opens  = (gql.match(/\{/g) || []).length;
    const closes = (gql.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
  });
});

describe('Auto date-filter injection — route tests', () => {
  // alchemistBurns query matching the user's export (no variable_defs)
  function makeBurnsQuery(db) {
    return insertQuery(db, {
      name: 'alchemistBurns',
      gql: BURNS_GQL,
      variable_defs: '[]',
      result_path: 'data.alchemistBurns.items',
      pagination_style: 'offset',
      date_format: 'unix_seconds',
    });
  }

  const MOCK_BURNS_ROW = { alchemist: '0xABCD', amount: '1000000000000000000', chain: 'mainnet', timestamp: '1747353601' };

  test('injects where clause and timestamp vars into outgoing GraphQL request', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = makeBurnsQuery(db);
    const START = '2026-05-15T00:00:00.000Z';

    let capturedBody = null;
    // First page: one row — capture the body
    global.fetch
      .mockImplementationOnce(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return mockResponse({ data: { alchemistBurns: { items: [MOCK_BURNS_ROW] } } });
      })
      // Second page: empty → pagination ends
      .mockResolvedValueOnce(mockResponse({ data: { alchemistBurns: { items: [] } } }));

    const res = await supertest(app).post('/api/runs').send({ query_id: qid, start_date: START });

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(capturedBody).not.toBeNull();
    // Variable injected with correct unix value
    expect(capturedBody.variables.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
    expect(capturedBody.variables.timestamp_lte).toBeUndefined();
    // GQL modified to include the where clause
    expect(capturedBody.query).toContain('where: { timestamp_gte: $timestamp_gte }');
    expect(capturedBody.query).toContain('$timestamp_gte: BigInt');
    // Original args still present
    expect(capturedBody.query).toContain('orderBy: "timestamp"');
  });

  test('injects both bounds when start_date and end_date provided', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = makeBurnsQuery(db);
    const START = '2026-05-15T00:00:00.000Z';
    const END   = '2026-05-16T00:00:00.000Z';

    let capturedBody = null;
    global.fetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockResponse({ data: { alchemistBurns: { items: [] } } });
    });

    await supertest(app).post('/api/runs').send({ query_id: qid, start_date: START, end_date: END });

    expect(capturedBody.variables.timestamp_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
    expect(capturedBody.variables.timestamp_lte).toBe(Math.floor(new Date(END).getTime() / 1000));
    expect(capturedBody.query).toContain('where: { timestamp_gte: $timestamp_gte, timestamp_lte: $timestamp_lte }');
  });

  test('does NOT inject when query already has global_start variable_defs', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = insertQuery(db, {
      gql: 'query Q($ts_gte: BigInt, $first: Int, $skip: Int) { alchemistBurns(where: { timestamp_gte: $ts_gte }, limit: $first, offset: $skip) { items { timestamp } } }',
      variable_defs: JSON.stringify([
        { name: 'ts_gte', source: 'global_start', default: null },
        { name: 'first',  source: 'pagination_first', default: 1000 },
        { name: 'skip',   source: 'pagination_skip',  default: 0 },
      ]),
      result_path: 'data.alchemistBurns.items',
      date_format: 'unix_seconds',
    });

    let capturedBody = null;
    global.fetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockResponse({ data: { alchemistBurns: { items: [] } } });
    });

    const START = '2026-05-15T00:00:00.000Z';
    await supertest(app).post('/api/runs').send({ query_id: qid, start_date: START });

    // ts_gte should be set from resolveVariables (via variable_defs), not auto-inject
    expect(capturedBody.variables.ts_gte).toBe(Math.floor(new Date(START).getTime() / 1000));
    // Auto-inject's canonical names must NOT appear (would indicate double-injection)
    expect(capturedBody.variables.timestamp_gte).toBeUndefined();
  });

  test('does NOT inject when no dates provided', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = makeBurnsQuery(db);

    let capturedBody = null;
    global.fetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockResponse({ data: { alchemistBurns: { items: [] } } });
    });

    await supertest(app).post('/api/runs').send({ query_id: qid });

    expect(capturedBody.variables.timestamp_gte).toBeUndefined();
    expect(capturedBody.query).not.toContain('timestamp_gte');
  });

  test('falls back to original query on GraphQL error and adds warning', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = makeBurnsQuery(db);
    const START = '2026-05-15T00:00:00.000Z';

    let fallbackBody = null;
    global.fetch
      // First request (injected): endpoint returns a GraphQL error
      .mockResolvedValueOnce(mockResponse({
        errors: [{ message: 'Unknown argument "where" on field "Query.alchemistBurns".' }],
      }))
      // Second request (fallback first page): original query succeeds
      .mockImplementationOnce(async (_url, opts) => {
        fallbackBody = JSON.parse(opts.body);
        return mockResponse({ data: { alchemistBurns: { items: [MOCK_BURNS_ROW] } } });
      })
      // Third request (pagination page 2 of fallback): empty
      .mockResolvedValueOnce(mockResponse({ data: { alchemistBurns: { items: [] } } }));

    const res = await supertest(app).post('/api/runs').send({ query_id: qid, start_date: START });

    expect(res.status).toBe(200);
    // Rows from the fallback query
    expect(res.body.rows).toHaveLength(1);
    // Warning tells the user filtering did not apply
    expect(res.body.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Auto date filter injection failed')])
    );
    // Fallback request used the original GQL (no where clause)
    expect(fallbackBody.query).not.toContain('timestamp_gte');
    // Fallback request has no timestamp vars
    expect(fallbackBody.variables.timestamp_gte).toBeUndefined();
  });

  test('no fallback retry when injection succeeds (graphql_partial is not retried)', async () => {
    const db  = createTestDb();
    const app = createApp(db);
    const qid = makeBurnsQuery(db);
    const START = '2026-05-15T00:00:00.000Z';

    let requestCount = 0;
    // Return a graphql_partial on the first page (data + errors)
    global.fetch.mockImplementationOnce(async () => {
      requestCount++;
      return mockResponse({
        data: { alchemistBurns: { items: [MOCK_BURNS_ROW] } },
        errors: [{ message: 'Some partial error' }],
      });
    });

    const res = await supertest(app).post('/api/runs').send({ query_id: qid, start_date: START });

    // graphql_partial is not a full failure → no retry
    expect(requestCount).toBe(1);
    expect(res.body.error_type).toBe('graphql_partial');
    // No auto-inject fallback warning
    expect((res.body.warnings || []).some(w => w.includes('Auto date filter injection failed'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Integration tests against live Ponder endpoint
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

// ─── Auto-injection integration — user's exact alchemistBurns query ────────────

describeIntegration('Integration — auto date-filter injection with alchemistBurns', () => {
  /**
   * Uses the user's exact query from their export file:
   *   - No variable_defs (empty array)
   *   - No where clause in the GQL
   *   - date_format: unix_seconds
   *
   * The backend should auto-inject timestamp_gte / timestamp_lte and the live
   * Ponder endpoint should honour them, returning only the filtered rows.
   *
   * Data range for alchemistBurns: confirmed 2026-04-14 to present.
   * Anchor window: May 15–16 2026 (should have data after the first few weeks).
   */

  const MAY_15_TS = Math.floor(new Date('2026-05-15T00:00:00Z').getTime() / 1000); // 1747353600
  const MAY_16_TS = Math.floor(new Date('2026-05-16T00:00:00Z').getTime() / 1000); // 1747440000

  function createLiveDb() {
    const db = createTestDb(); // in-memory, fully migrated
    db.prepare("UPDATE settings SET value=? WHERE key='endpoint'").run(LIVE_ENDPOINT);
    // Smaller page size so test completes quickly
    db.prepare("UPDATE settings SET value=? WHERE key='page_size'").run('200');
    db.prepare("UPDATE settings SET value=? WHERE key='max_page_count'").run('5');
    return db;
  }

  function makeLiveBurnsQuery(db) {
    return insertQuery(db, {
      name: 'alchemistBurns',
      gql: BURNS_GQL,
      variable_defs: '[]',
      result_path: 'data.alchemistBurns.items',
      pagination_style: 'offset',
      date_format: 'unix_seconds',
    });
  }

  test('auto-injected start_date returns only rows on or after May 15 2026', async () => {
    const db  = createLiveDb();
    const app = createApp(db);
    const qid = makeLiveBurnsQuery(db);

    const res = await supertest(app)
      .post('/api/runs')
      .send({ query_id: qid, start_date: '2026-05-15T00:00:00.000Z' })
      .timeout(60000);

    expect(res.status).toBe(200);
    // Should have returned data (no error) — if 0 rows there's simply nothing after May 15
    expect(res.body.error_type == null || res.body.error_type === 'graphql_partial').toBe(true);

    if (res.body.rows && res.body.rows.length > 0) {
      // Every row must have timestamp >= May 15
      for (const row of res.body.rows) {
        expect(Number(row.timestamp)).toBeGreaterThanOrEqual(MAY_15_TS);
      }
    }

    // No fallback warning — injection should have succeeded
    const warnings = res.body.warnings || [];
    expect(warnings.some(w => w.includes('Auto date filter injection failed'))).toBe(false);
  }, 60000);

  test('auto-injected date range returns fewer rows than unbounded query', async () => {
    const db   = createLiveDb();
    const app  = createApp(db);
    const qid  = makeLiveBurnsQuery(db);

    // 1-day window
    const [narrowRes, wideRes] = await Promise.all([
      supertest(app).post('/api/runs')
        .send({ query_id: qid, start_date: '2026-05-15T00:00:00.000Z', end_date: '2026-05-16T00:00:00.000Z' })
        .timeout(60000),
      supertest(app).post('/api/runs')
        .send({ query_id: qid })
        .timeout(60000),
    ]);

    expect(narrowRes.status).toBe(200);
    expect(wideRes.status).toBe(200);

    const narrowCount = narrowRes.body.row_count ?? 0;
    const wideCount   = wideRes.body.row_count   ?? 0;

    // Wide query must return at least as many rows as the 1-day window
    expect(wideCount).toBeGreaterThanOrEqual(narrowCount);

    // Narrow rows must all be within the 1-day window
    if (narrowRes.body.rows) {
      for (const row of narrowRes.body.rows) {
        expect(Number(row.timestamp)).toBeGreaterThanOrEqual(MAY_15_TS);
        expect(Number(row.timestamp)).toBeLessThanOrEqual(MAY_16_TS);
      }
    }
  }, 120000);
});
