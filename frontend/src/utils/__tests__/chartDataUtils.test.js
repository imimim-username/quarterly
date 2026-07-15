import { describe, it, expect } from 'vitest'
import {
  applyDivisorNumeric,
  bucketTimestamp,
  aggregate,
  buildChartData,
  fmtAxisVal,
  fmtXLabel,
} from '../chartDataUtils.js'

// ─── applyDivisorNumeric ──────────────────────────────────────────────────────

describe('applyDivisorNumeric', () => {
  it('returns null for null', () => expect(applyDivisorNumeric(null, 'raw')).toBeNull())
  it('returns null for undefined', () => expect(applyDivisorNumeric(undefined, 'raw')).toBeNull())
  it('returns null for empty string', () => expect(applyDivisorNumeric('', 'raw')).toBeNull())

  it('returns Number for raw divisor', () => {
    expect(applyDivisorNumeric('42', 'raw')).toBe(42)
    expect(applyDivisorNumeric(100, 'raw')).toBe(100)
  })

  it('returns Number when no divisor supplied', () => {
    expect(applyDivisorNumeric('7', undefined)).toBe(7)
  })

  it('treats datetime divisor as raw', () => {
    expect(applyDivisorNumeric('1705276800', 'datetime')).toBe(1705276800)
  })

  it('divides by 1e6 using BigInt precision', () => {
    expect(applyDivisorNumeric('1000000', '1e6')).toBeCloseTo(1)
    expect(applyDivisorNumeric('1500000', '1e6')).toBeCloseTo(1.5)
  })

  it('divides by 1e18 using BigInt precision', () => {
    expect(applyDivisorNumeric('1000000000000000000', '1e18')).toBeCloseTo(1)
    expect(applyDivisorNumeric('1500000000000000000', '1e18')).toBeCloseTo(1.5)
  })

  it('returns Number (not BigInt) for 1e18 divisor', () => {
    const result = applyDivisorNumeric('1000000000000000000', '1e18')
    expect(typeof result).toBe('number')
  })

  it('falls back to Number() when BigInt conversion fails', () => {
    // Non-integer string can't be BigInt — falls back to Number()
    expect(applyDivisorNumeric('1.5', '1e18')).toBe(1.5)
  })
})

// ─── bucketTimestamp ──────────────────────────────────────────────────────────

// 2024-01-15 00:00:00 UTC
const JAN15 = 1705276800
// 2024-01-16 12:00:00 UTC
const JAN16_NOON = 1705406400
// 2024-02-01 00:00:00 UTC
const FEB01 = 1706745600
// 2024-01-08 00:00:00 UTC  (start of a week: 604800 * N)
const WEEK_ANCHOR = Math.floor(JAN15 / 604800) * 604800

describe('bucketTimestamp', () => {
  it('groupBy=day: collapses same-day timestamps to midnight UTC', () => {
    const ts1 = JAN15
    const ts2 = JAN15 + 3600  // 1 hour later, same day
    expect(bucketTimestamp(ts1, 'day')).toBe(bucketTimestamp(ts2, 'day'))
  })

  it('groupBy=day: different days produce different buckets', () => {
    expect(bucketTimestamp(JAN15, 'day')).not.toBe(bucketTimestamp(JAN16_NOON, 'day'))
  })

  it('groupBy=week: collapses timestamps within the same week', () => {
    // Both JAN15 and JAN16_NOON are in the same calendar week
    expect(bucketTimestamp(JAN15, 'week')).toBe(bucketTimestamp(JAN16_NOON, 'week'))
  })

  it('groupBy=week: bucket is a multiple of 604800', () => {
    const bucket = bucketTimestamp(JAN15, 'week')
    expect(bucket % 604800).toBe(0)
  })

  it('groupBy=month: collapses timestamps within the same month', () => {
    expect(bucketTimestamp(JAN15, 'month')).toBe(bucketTimestamp(JAN16_NOON, 'month'))
  })

  it('groupBy=month: different months produce different buckets', () => {
    expect(bucketTimestamp(JAN15, 'month')).not.toBe(bucketTimestamp(FEB01, 'month'))
  })

  it('groupBy=none (unrecognised): returns the raw timestamp as a number', () => {
    expect(bucketTimestamp(JAN15, 'none')).toBe(JAN15)
  })
})

// ─── aggregate ────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('sum (default)', () => expect(aggregate([1, 2, 3], 'sum')).toBe(6))
  it('avg', () => expect(aggregate([1, 2, 3], 'avg')).toBeCloseTo(2))
  it('min', () => expect(aggregate([3, 1, 2], 'min')).toBe(1))
  it('max', () => expect(aggregate([3, 1, 2], 'max')).toBe(3))
  it('count', () => expect(aggregate([10, 20, 30], 'count')).toBe(3))

  it('median: odd count', () => expect(aggregate([3, 1, 2], 'median')).toBe(2))
  it('median: even count', () => expect(aggregate([1, 2, 3, 4], 'median')).toBe(2.5))

  it('returns null for empty array', () => expect(aggregate([], 'sum')).toBeNull())
  it('returns null for all-null/NaN array', () => expect(aggregate([null, NaN], 'sum')).toBeNull())
  it('excludes nulls and NaN from computation', () => expect(aggregate([1, null, NaN, 2], 'sum')).toBe(3))
  it('count only counts non-null values', () => expect(aggregate([1, null, NaN, 2], 'count')).toBe(2))
})

// ─── buildChartData ───────────────────────────────────────────────────────────

describe('buildChartData', () => {
  const ROWS = [
    { ts: JAN15,       amount: 100 },
    { ts: JAN15 + 60,  amount: 200 }, // same bucket as above (same day)
    { ts: JAN16_NOON,  amount: 50  },
  ]

  it('returns empty array for null/empty rows', () => {
    expect(buildChartData(null,  'ts', ['amount'], {}, 'none', 'raw', 'sum')).toEqual([])
    expect(buildChartData([],    'ts', ['amount'], {}, 'none', 'raw', 'sum')).toEqual([])
  })

  it('returns empty array for empty yFields', () => {
    expect(buildChartData(ROWS, 'ts', [], {}, 'none', 'raw', 'sum')).toEqual([])
  })

  it('returns empty array if xField missing', () => {
    expect(buildChartData(ROWS, '', ['amount'], {}, 'none', 'raw', 'sum')).toEqual([])
  })

  it('groupBy=none: one data point per unique x value', () => {
    const result = buildChartData(ROWS, 'ts', ['amount'], {}, 'none', 'raw', 'sum')
    expect(result).toHaveLength(3)
  })

  it('groupBy=day: merges same-day rows by summing', () => {
    const result = buildChartData(ROWS, 'ts', ['amount'], {}, 'day', 'raw', 'sum')
    expect(result).toHaveLength(2)
    const day1 = result.find(p => p.x === bucketTimestamp(JAN15, 'day'))
    expect(day1.amount).toBe(300) // 100 + 200
  })

  it('groupBy=day + avg aggregation: computes mean per bucket', () => {
    const result = buildChartData(ROWS, 'ts', ['amount'], {}, 'day', 'raw', 'avg')
    const day1 = result.find(p => p.x === bucketTimestamp(JAN15, 'day'))
    expect(day1.amount).toBe(150)
  })

  it('sorts ascending by default (numeric x)', () => {
    const shuffled = [
      { ts: JAN16_NOON, amount: 50 },
      { ts: JAN15,      amount: 100 },
    ]
    const result = buildChartData(shuffled, 'ts', ['amount'], {}, 'none', 'raw', 'sum')
    expect(result[0].x).toBe(JAN15)
    expect(result[1].x).toBe(JAN16_NOON)
  })

  it('xSortDir=desc reverses the order', () => {
    const result = buildChartData(ROWS.slice(0, 2).concat(ROWS[2]), 'ts', ['amount'], {}, 'none', 'raw', 'sum', 'desc')
    // Last timestamp should be first
    expect(Number(result[0].x)).toBeGreaterThan(Number(result[result.length - 1].x))
  })

  it('yMode=cumulative: accumulates values across sorted data points', () => {
    const rows = [
      { ts: JAN15,      amount: 10 },
      { ts: JAN16_NOON, amount: 20 },
    ]
    const result = buildChartData(rows, 'ts', ['amount'], {}, 'none', 'cumulative', 'sum')
    expect(result[0].amount).toBe(10)
    expect(result[1].amount).toBe(30)
  })

  it('yMode=cumulative with null value: treats null as 0', () => {
    const rows = [
      { ts: JAN15,      amount: 10 },
      { ts: JAN16_NOON, amount: null },
      { ts: FEB01,      amount: 5 },
    ]
    const result = buildChartData(rows, 'ts', ['amount'], {}, 'none', 'cumulative', 'sum')
    expect(result[0].amount).toBe(10)
    expect(result[1].amount).toBe(10)  // null treated as 0
    expect(result[2].amount).toBe(15)
  })

  it('applies 1e18 divisor before aggregation', () => {
    const rows = [
      { ts: JAN15, wei: '1000000000000000000' },
      { ts: JAN15, wei: '2000000000000000000' },
    ]
    const result = buildChartData(rows, 'ts', ['wei'], { wei: '1e18' }, 'none', 'raw', 'sum')
    // 1 + 2 = 3 ETH
    expect(result[0].wei).toBeCloseTo(3)
  })

  it('handles multiple yFields independently', () => {
    const rows = [
      { ts: JAN15, a: 10, b: 100 },
      { ts: JAN15, a: 20, b: 200 },
    ]
    const result = buildChartData(rows, 'ts', ['a', 'b'], {}, 'none', 'raw', 'sum')
    expect(result[0].a).toBe(30)
    expect(result[0].b).toBe(300)
  })

  it('string x field: sorts lexicographically', () => {
    const rows = [
      { chain: 'ethereum', count: 1 },
      { chain: 'arbitrum', count: 2 },
      { chain: 'base',     count: 3 },
    ]
    const result = buildChartData(rows, 'chain', ['count'], {}, 'none', 'raw', 'sum')
    expect(result.map(p => p.x)).toEqual(['arbitrum', 'base', 'ethereum'])
  })

  it('rows with undefined yField value: treated as missing (not zero)', () => {
    const rows = [
      { ts: JAN15, amount: undefined },
      { ts: JAN15, amount: 5 },
    ]
    // Only the non-undefined value should aggregate
    const result = buildChartData(rows, 'ts', ['amount'], {}, 'none', 'raw', 'sum')
    expect(result[0].amount).toBe(5)
  })
})

// ─── fmtAxisVal ───────────────────────────────────────────────────────────────

describe('fmtAxisVal', () => {
  it('values < 1000: returns plain string', () => expect(fmtAxisVal(42)).toBe('42'))
  it('thousands → K suffix', () => expect(fmtAxisVal(1500)).toBe('1.5K'))
  it('millions → M suffix', () => expect(fmtAxisVal(2500000)).toBe('2.5M'))
  it('billions → B suffix', () => expect(fmtAxisVal(3000000000)).toBe('3B'))
  it('trillions → T suffix', () => expect(fmtAxisVal(1e12)).toBe('1T'))
  it('negative values use absolute magnitude for suffix selection', () => {
    expect(fmtAxisVal(-1500)).toBe('-1.5K')
  })
  it('zero', () => expect(fmtAxisVal(0)).toBe('0'))

  // BUG 3 fix: non-finite inputs should not produce garbage like "InfinityT"
  it('Infinity returns "Infinity" (not "InfinityT")', () => {
    expect(fmtAxisVal(Infinity)).toBe('Infinity')
  })
  it('-Infinity returns "-Infinity"', () => {
    expect(fmtAxisVal(-Infinity)).toBe('-Infinity')
  })
  it('NaN returns "NaN"', () => {
    expect(fmtAxisVal(NaN)).toBe('NaN')
  })
  it('undefined coerces to NaN → "NaN"', () => {
    expect(fmtAxisVal(undefined)).toBe('NaN')
  })
})

// ─── fmtXLabel ────────────────────────────────────────────────────────────────

describe('fmtXLabel', () => {
  it('groupBy=none + unix timestamp: formats as locale date', () => {
    const result = fmtXLabel(JAN15, 'none', 'ts')
    // Should be a non-empty string — locale-dependent, just check it's not the raw number
    expect(typeof result).toBe('string')
    expect(result).not.toBe(String(JAN15))
  })

  it('groupBy=none + non-timestamp string: returns as-is', () => {
    expect(fmtXLabel('ethereum', 'none', 'chain')).toBe('ethereum')
  })

  it('groupBy=day: formats as locale short date (no year)', () => {
    const result = fmtXLabel(JAN15, 'day', 'ts')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('groupBy=month: formats with short month and 2-digit year', () => {
    const result = fmtXLabel(JAN15, 'month', 'ts')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ─── buildChartData — edge cases ─────────────────────────────────────────────

describe('buildChartData — edge cases', () => {
  it('single row, single field', () => {
    const rows = [{ ts: JAN15, v: 7 }]
    const result = buildChartData(rows, 'ts', ['v'], {}, 'none', 'raw', 'sum')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ x: JAN15, v: 7 })
  })

  it('all rows map to the same bucket: single output point', () => {
    const rows = [
      { ts: JAN15,       v: 1 },
      { ts: JAN15 + 60,  v: 2 },
      { ts: JAN15 + 120, v: 3 },
    ]
    const result = buildChartData(rows, 'ts', ['v'], {}, 'day', 'raw', 'sum')
    expect(result).toHaveLength(1)
    expect(result[0].v).toBe(6)
  })

  it('cumulative over grouped data: running sum across day buckets', () => {
    const rows = [
      { ts: JAN15,      v: 10 },
      { ts: JAN16_NOON, v: 5  },
      { ts: FEB01,      v: 20 },
    ]
    const result = buildChartData(rows, 'ts', ['v'], {}, 'day', 'cumulative', 'sum')
    expect(result[0].v).toBe(10)
    expect(result[1].v).toBe(15)
    expect(result[2].v).toBe(35)
  })
})
