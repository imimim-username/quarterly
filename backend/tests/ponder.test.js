'use strict';

const { fetchAllPages } = require('../src/ponder');

const ENDPOINT = 'http://127.0.0.1:9999';
const GQL_PATH = '/graphql';
const ENDPOINT_FULL = ENDPOINT + GQL_PATH;

// Mock a native-fetch-compatible Response object
function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// Minimal query def
function makeQueryDef(overrides = {}) {
  return {
    result_path: 'data.items',
    pagination_style: 'offset',
    cursor_path: '',
    has_next_path: '',
    ...overrides,
  };
}

// Default settings
function makeSettings(overrides = {}) {
  return {
    page_size: '1000',
    max_page_count: '50',
    max_row_count: '50000',
    timeout_per_page_ms: '30000',
    warn_bytes: '1048576',
    max_bytes: '10485760',
    ...overrides,
  };
}

// Generate N dummy rows
function makeRows(n, startId = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: String(startId + i) }));
}

let _realFetch;
beforeEach(() => {
  _realFetch = global.fetch;
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = _realFetch;
});

describe('fetchAllPages — offset pagination', () => {
  test('offset: 2500 rows fetched in 3 pages (pageSize=1000)', async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, 0) } }))
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, 1000) } }))
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(500, 2000) } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBeNull();
    expect(result.rows).toHaveLength(2500);
    expect(result.page_count).toBe(3);
  });

  test('offset: exactly 1000 rows (full page, then empty)', async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, 0) } }))
      .mockResolvedValueOnce(mockResponse({ data: { items: [] } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBeNull();
    expect(result.rows).toHaveLength(1000);
    expect(result.page_count).toBe(2);
  });

  test('offset: 0 rows → empty result', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: [] } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBeNull();
    expect(result.rows).toHaveLength(0);
    expect(result.page_count).toBe(1);
  });

  test('result_path non-array → path_error', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: 'not an array' } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBe('path_error');
    expect(result.rows).toBeNull();
  });

  test('max_page_count exceeded → page_limit error', async () => {
    // With max_page_count=2, we need 3 full pages to trigger limit
    const settings = makeSettings({ page_size: '10', max_page_count: '2' });
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(10, 0) } }))
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(10, 10) } }))
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(10, 20) } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), settings, null);
    expect(result.error_type).toBe('page_limit');
    expect(result.rows).toBeNull();
  });

  test('max_row_count exceeded → row_limit error (49500 + 1000 = abort)', async () => {
    // max_row_count = 49500, page_size = 1000
    const settings = makeSettings({ page_size: '1000', max_row_count: '49500', max_page_count: '100' });

    // 49 full pages (49000 rows)
    for (let i = 0; i < 49; i++) {
      global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, i * 1000) } }));
    }
    // 50th request would push 49000 + 1000 = 50000 > 49500
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, 49000) } }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), settings, null);
    expect(result.error_type).toBe('row_limit');
    expect(result.rows).toBeNull();
  });

  test('GraphQL errors only (no data) → graphql error, not saved', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({
      errors: [{ message: 'Field not found' }],
    }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBe('graphql');
    expect(result.rows).toBeNull();
    expect(result.graphql_errors).toHaveLength(1);
  });

  test('GraphQL data+errors → graphql_partial, stops immediately', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse({
      data: { items: makeRows(5, 0) },
      errors: [{ message: 'Partial result' }],
    }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBe('graphql_partial');
    expect(result.rows).toHaveLength(5);
    expect(result.graphql_errors).toHaveLength(1);
    expect(result.page_count).toBe(1);
  });

  test('network timeout on page 2 → timeout error, partial rows NOT saved', async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse({ data: { items: makeRows(1000, 0) } }))
      .mockRejectedValueOnce(new Error('Connection reset'));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), makeSettings(), null);
    expect(result.error_type).toBe('network');
    expect(result.rows).toBeNull();
    // page_count is 1 (first page fetched before error)
    expect(result.page_count).toBe(1);
  });

  test('response size > warn_bytes → warnings populated', async () => {
    // Create a large row to trigger size warning
    const bigRow = { id: '0', data: 'x'.repeat(200000) };
    global.fetch.mockResolvedValueOnce(mockResponse({ data: { items: [bigRow] } }));

    const settings = makeSettings({ warn_bytes: '100', max_bytes: '10485760' });
    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', {}, makeQueryDef(), settings, null);
    expect(result.error_type).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/warn_bytes/i);
  });
});

describe('fetchAllPages — cursor pagination', () => {
  test('cursor: 3 pages with hasNextPage', async () => {
    const queryDef = makeQueryDef({
      result_path: 'data.page.items',
      pagination_style: 'cursor',
      cursor_path: 'data.page.pageInfo.endCursor',
      has_next_path: 'data.page.pageInfo.hasNextPage',
    });

    global.fetch
      .mockResolvedValueOnce(mockResponse({
        data: { page: { items: makeRows(10, 0), pageInfo: { hasNextPage: true, endCursor: 'cursor1' } } },
      }))
      .mockResolvedValueOnce(mockResponse({
        data: { page: { items: makeRows(10, 10), pageInfo: { hasNextPage: true, endCursor: 'cursor2' } } },
      }))
      .mockResolvedValueOnce(mockResponse({
        data: { page: { items: makeRows(5, 20), pageInfo: { hasNextPage: false, endCursor: null } } },
      }));

    const result = await fetchAllPages(ENDPOINT_FULL, '{ page }', {}, queryDef, makeSettings(), null);
    expect(result.error_type).toBeNull();
    expect(result.rows).toHaveLength(25);
    expect(result.page_count).toBe(3);
  });
});

describe('fetchAllPages — pagination_style none', () => {
  test('none: single request, no pagination vars injected', async () => {
    let capturedBody;
    global.fetch.mockImplementationOnce(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockResponse({ data: { items: makeRows(5, 0) } });
    });

    const queryDef = makeQueryDef({ pagination_style: 'none' });
    const result = await fetchAllPages(ENDPOINT_FULL, '{ items { id } }', { myVar: 'value' }, queryDef, makeSettings(), null);
    expect(result.error_type).toBeNull();
    expect(result.rows).toHaveLength(5);
    expect(result.page_count).toBe(1);
    // Should not have injected first/skip/after
    if (capturedBody) {
      const vars = capturedBody.variables || {};
      expect(vars.first).toBeUndefined();
      expect(vars.skip).toBeUndefined();
      expect(vars.after).toBeUndefined();
      expect(vars.myVar).toBe('value');
    }
  });
});
