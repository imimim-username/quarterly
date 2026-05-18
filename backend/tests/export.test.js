'use strict';

const { scaledDecimal, flattenRow, computeColumnOrder, toCsv } = require('../src/export');

// ─── scaledDecimal ───────────────────────────────────────────────────────────

describe('scaledDecimal', () => {
  test('"1500000000000000000" / 18 → "1.5"', () => {
    expect(scaledDecimal('1500000000000000000', 18)).toBe('1.5');
  });

  test('"1000000000000000000" / 18 → "1" (no trailing fraction)', () => {
    expect(scaledDecimal('1000000000000000000', 18)).toBe('1');
  });

  test('"100" / 18 → "0.0000000000000001"', () => {
    expect(scaledDecimal('100', 18)).toBe('0.0000000000000001');
  });

  test('"0" / 18 → "0"', () => {
    expect(scaledDecimal('0', 18)).toBe('0');
  });

  test('"-500000000000000000" / 18 → "-0.5"', () => {
    expect(scaledDecimal('-500000000000000000', 18)).toBe('-0.5');
  });

  test('"-1" / 18 → "-0.000000000000000001"', () => {
    expect(scaledDecimal('-1', 18)).toBe('-0.000000000000000001');
  });

  test('large value with no precision loss (BigInt precision)', () => {
    // 123456789012345678 / 18 should not lose precision
    const result = scaledDecimal('123456789012345678000000000000000000', 18);
    expect(result).toBe('123456789012345678');
  });
});

// ─── flattenRow ──────────────────────────────────────────────────────────────

describe('flattenRow', () => {
  test('flat row: all scalars become direct columns', () => {
    const row = { id: '1', name: 'Alice', count: 42 };
    const result = flattenRow(row, {}, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: '1', name: 'Alice', count: 42 });
  });

  test('nested object: dot-notation up to depth 3', () => {
    const row = { id: '1', meta: { value: 'hello', inner: { x: 1 } } };
    const result = flattenRow(row, {}, 0);
    expect(result).toHaveLength(1);
    // depth 0: meta.value → meta_value, meta.inner → object at depth 1
    // depth 1: inner.x → inner_x
    expect(result[0].id).toBe('1');
    expect(result[0].meta_value).toBe('hello');
    expect(result[0].meta_inner_x).toBe(1);
  });

  test('nested object depth > 3 → JSON string', () => {
    const deepObj = { a: { b: { c: { d: 'deep' } } } };
    const row = { id: '1', nested: deepObj };
    const result = flattenRow(row, {}, 0);
    expect(result).toHaveLength(1);
    // At depth 0: nested.a → at depth 1: b → at depth 2 (>= 2): serialize as JSON
    expect(result[0].nested_a_b).toBe(JSON.stringify({ c: { d: 'deep' } }));
  });

  test('nested array: expands to multiple rows; parent scalars repeated', () => {
    const row = { id: '1', tags: [{ name: 'alpha' }, { name: 'beta' }] };
    const result = flattenRow(row, {}, 0);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[0].tags_name).toBe('alpha');
    expect(result[1].id).toBe('1');
    expect(result[1].tags_name).toBe('beta');
  });

  test('missing keys in one row → empty cell in CSV output', () => {
    const rows = [
      { id: '1', value: '100' },
      { id: '2' }, // missing 'value'
    ];
    const csv = toCsv(rows, {}, 'id');
    expect(csv).toContain('id');
    // Second row should have empty string for missing value
    const lines = csv.trim().split('\n');
    expect(lines[2]).toMatch(/^2,$/); // id=2, value=''
  });
});

// ─── computeColumnOrder ──────────────────────────────────────────────────────

describe('computeColumnOrder', () => {
  test('key field first, then insertion order of first row', () => {
    const rows = [
      { b: 1, c: 2, a: 3 },
    ];
    const cols = computeColumnOrder(rows, 'a');
    expect(cols[0]).toBe('a');
    expect(cols[1]).toBe('b');
    expect(cols[2]).toBe('c');
  });

  test('later rows: keys not in first row appended in first-seen order', () => {
    const rows = [
      { id: '1', x: 1 },
      { id: '2', x: 2, y: 3, z: 4 },
    ];
    const cols = computeColumnOrder(rows, 'id');
    expect(cols).toEqual(['id', 'x', 'y', 'z']);
  });

  test('no key field: insertion order of first row', () => {
    const rows = [{ c: 3, a: 1, b: 2 }];
    const cols = computeColumnOrder(rows, null);
    expect(cols).toEqual(['c', 'a', 'b']);
  });
});

// ─── CSV formula injection ───────────────────────────────────────────────────

describe('toCsv — formula injection protection', () => {
  function getFirstDataLine(csv) {
    return csv.trim().split('\n')[1] || '';
  }

  test('=FORMULA prefix is escaped with leading single quote', () => {
    const rows = [{ id: '1', val: '=FORMULA' }];
    const csv = toCsv(rows, {}, 'id');
    expect(getFirstDataLine(csv)).toContain("'=FORMULA");
  });

  test('+ prefix is escaped', () => {
    const rows = [{ id: '1', val: '+BAD' }];
    const csv = toCsv(rows, {}, 'id');
    expect(getFirstDataLine(csv)).toContain("'+BAD");
  });

  test('- prefix is escaped', () => {
    const rows = [{ id: '1', val: '-BAD' }];
    const csv = toCsv(rows, {}, 'id');
    expect(getFirstDataLine(csv)).toContain("'-BAD");
  });

  test('@ prefix is escaped', () => {
    const rows = [{ id: '1', val: '@BAD' }];
    const csv = toCsv(rows, {}, 'id');
    expect(getFirstDataLine(csv)).toContain("'@BAD");
  });

  test('normal string not escaped', () => {
    const rows = [{ id: '1', val: 'hello' }];
    const csv = toCsv(rows, {}, 'id');
    expect(getFirstDataLine(csv)).toContain('hello');
    expect(getFirstDataLine(csv)).not.toContain("'hello");
  });
});

// ─── toCsv — decimal scaling ─────────────────────────────────────────────────

describe('toCsv — decimal scaling via fieldMeta', () => {
  test('field with decimals=18 is scaled in CSV output', () => {
    const rows = [{ id: '1', amount: '1500000000000000000' }];
    const fieldMeta = { amount: { decimals: 18 } };
    const csv = toCsv(rows, fieldMeta, 'id');
    expect(csv).toContain('1.5');
    expect(csv).not.toContain('1500000000000000000');
  });
});

// ─── toCsv — empty rows ──────────────────────────────────────────────────────

describe('toCsv — edge cases', () => {
  test('empty rows array → empty string', () => {
    expect(toCsv([], {}, 'id')).toBe('');
  });
});
