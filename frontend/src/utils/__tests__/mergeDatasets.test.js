import { describe, it, expect } from 'vitest'
import { mergeDatasets, formatXLabel } from '../mergeDatasets.js'

// ─── fixtures ──────────────────────────────────────────────────────────────────

// 2024-01-15 00:00:00 UTC  → unix 1705276800
// 2024-01-16 00:00:00 UTC  → unix 1705363200
// 2024-01-17 00:00:00 UTC  → unix 1705449600
// 2024-02-01 00:00:00 UTC  → unix 1706745600
// 2024-01-01 00:00:00 UTC  → unix 1704067200  (month bucket for Jan 2024)

const DAY_JAN15 = 1705276800
const DAY_JAN16 = 1705363200
const DAY_JAN17 = 1705449600
const DAY_FEB01 = 1706745600
const MONTH_JAN = 1704067200
const MONTH_FEB = 1706745600

// ─── mergeDatasets — guard cases ──────────────────────────────────────────────

describe('mergeDatasets — guard cases', () => {
  it('returns empty result for empty array', () => {
    const result = mergeDatasets([])
    expect(result).toEqual({ xKeys: [], rows: [], seriesKeys: {} })
  })

  it('returns empty result for null/undefined', () => {
    expect(mergeDatasets(null)).toEqual({ xKeys: [], rows: [], seriesKeys: {} })
    expect(mergeDatasets(undefined)).toEqual({ xKeys: [], rows: [], seriesKeys: {} })
  })

  it('handles a dataset with no rows', () => {
    const { xKeys, rows } = mergeDatasets([{
      id: 'a', rows: [], xField: 'ts', yFields: ['val'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
    }])
    expect(xKeys).toEqual([])
    expect(rows).toEqual([])
  })

  it('handles a dataset with empty yFields', () => {
    const { rows } = mergeDatasets([{
      id: 'a',
      rows: [{ ts: DAY_JAN15, val: 5 }],
      xField: 'ts', yFields: [],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
    }])
    // xKeys should include the bucket but rows have no y columns
    expect(rows[0]).toMatchObject({ x: DAY_JAN15 })
  })

  it('skips rows where the x field is null/undefined', () => {
    const { xKeys } = mergeDatasets([{
      id: 'a',
      rows: [{ ts: null, val: 1 }, { ts: DAY_JAN15, val: 2 }],
      xField: 'ts', yFields: ['val'],
      colDivisors: {}, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
    }])
    expect(xKeys).toHaveLength(1)
    expect(xKeys[0]).toBe(DAY_JAN15)
  })
})

// ─── single dataset — basic merge ─────────────────────────────────────────────

describe('mergeDatasets — single dataset, groupBy:none', () => {
  const ds = {
    id: 'a',
    rows: [
      { ts: 100, val: 10 },
      { ts: 200, val: 20 },
      { ts: 300, val: 30 },
    ],
    xField: 'ts', yFields: ['val'],
    colDivisors: {}, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
  }

  it('produces one row per unique x value', () => {
    const { rows } = mergeDatasets([ds])
    expect(rows).toHaveLength(3)
  })

  it('keys rows by the raw x value', () => {
    const { xKeys } = mergeDatasets([ds])
    expect(xKeys).toEqual([100, 200, 300])
  })

  it('prefixes series column with d0_', () => {
    const { rows } = mergeDatasets([ds])
    expect(rows[0]).toHaveProperty('d0_val', 10)
    expect(rows[1]).toHaveProperty('d0_val', 20)
  })

  it('builds correct seriesKeys map', () => {
    const { seriesKeys } = mergeDatasets([ds])
    expect(seriesKeys['0:val']).toBe('d0_val')
  })

  it('sorts xKeys ascending', () => {
    const shuffled = { ...ds, rows: [{ ts: 300, val: 3 }, { ts: 100, val: 1 }, { ts: 200, val: 2 }] }
    const { xKeys } = mergeDatasets([shuffled])
    expect(xKeys).toEqual([100, 200, 300])
  })
})

// ─── single dataset — aggregation ─────────────────────────────────────────────

describe('mergeDatasets — aggregation', () => {
  // Two rows with the same day bucket but different timestamps
  const rows = [
    { ts: DAY_JAN15,      val: 10 },
    { ts: DAY_JAN15 + 60, val: 30 }, // same day, different second
  ]
  const base = { id: 'a', rows, xField: 'ts', yFields: ['val'], colDivisors: {}, groupBy: 'day', yMode: 'raw' }

  it('sum: sums values in same bucket', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'sum' }])
    expect(merged).toHaveLength(1)
    expect(merged[0].d0_val).toBe(40)
  })

  it('avg: averages values in same bucket', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'avg' }])
    expect(merged[0].d0_val).toBe(20)
  })

  it('min: picks minimum', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'min' }])
    expect(merged[0].d0_val).toBe(10)
  })

  it('max: picks maximum', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'max' }])
    expect(merged[0].d0_val).toBe(30)
  })

  it('count: counts non-null entries', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'count' }])
    expect(merged[0].d0_val).toBe(2)
  })

  it('median: returns middle value (odd count)', () => {
    const r = [
      { ts: DAY_JAN15,      val: 10 },
      { ts: DAY_JAN15 + 60, val: 20 },
      { ts: DAY_JAN15 + 120, val: 60 },
    ]
    const { rows: merged } = mergeDatasets([{ ...base, rows: r, aggregation: 'median' }])
    expect(merged[0].d0_val).toBe(20)
  })

  it('median: averages middle two values (even count)', () => {
    const { rows: merged } = mergeDatasets([{ ...base, aggregation: 'median' }])
    expect(merged[0].d0_val).toBe(20) // (10+30)/2
  })
})

// ─── single dataset — groupBy bucketing ───────────────────────────────────────

describe('mergeDatasets — groupBy bucketing', () => {
  // Timestamps at different times within the same day / week / month
  const rows = [
    { ts: DAY_JAN15,      val: 5 },
    { ts: DAY_JAN15 + 3600, val: 10 }, // 1h later, same day
    { ts: DAY_JAN16,      val: 20 },
  ]
  const base = { id: 'a', rows, xField: 'ts', yFields: ['val'], colDivisors: {}, aggregation: 'sum', yMode: 'raw' }

  it('groupBy:day collapses intra-day timestamps to midnight UTC', () => {
    const { xKeys, rows: merged } = mergeDatasets([{ ...base, groupBy: 'day' }])
    expect(xKeys).toHaveLength(2)
    // First bucket is DAY_JAN15 midnight UTC
    expect(xKeys[0]).toBe(DAY_JAN15)
    expect(merged[0].d0_val).toBe(15) // 5+10
    expect(merged[1].d0_val).toBe(20)
  })

  it('groupBy:month collapses all Jan rows to Jan 1 UTC midnight', () => {
    const { xKeys, rows: merged } = mergeDatasets([{ ...base, groupBy: 'month' }])
    expect(xKeys).toHaveLength(1)
    expect(xKeys[0]).toBe(MONTH_JAN)
    expect(merged[0].d0_val).toBe(35) // 5+10+20
  })

  it('groupBy:week uses 604800-second floors', () => {
    const weekStart = Math.floor(DAY_JAN15 / 604800) * 604800
    const { xKeys } = mergeDatasets([{ ...base, groupBy: 'week' }])
    // Both rows are in the same week
    expect(xKeys[0]).toBe(weekStart)
  })
})

// ─── single dataset — cumulative mode ─────────────────────────────────────────

describe('mergeDatasets — yMode:cumulative', () => {
  const rows = [
    { ts: DAY_JAN15, val: 10 },
    { ts: DAY_JAN16, val: 20 },
    { ts: DAY_JAN17, val: 5 },
  ]
  const ds = { id: 'a', rows, xField: 'ts', yFields: ['val'], colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'cumulative' }

  it('accumulates values across buckets in sorted order', () => {
    const { rows: merged } = mergeDatasets([ds])
    expect(merged[0].d0_val).toBe(10)
    expect(merged[1].d0_val).toBe(30)
    expect(merged[2].d0_val).toBe(35)
  })

  it('raw mode does not accumulate', () => {
    const { rows: merged } = mergeDatasets([{ ...ds, yMode: 'raw' }])
    expect(merged[0].d0_val).toBe(10)
    expect(merged[1].d0_val).toBe(20)
    expect(merged[2].d0_val).toBe(5)
  })
})

// ─── single dataset — divisors ────────────────────────────────────────────────

describe('mergeDatasets — colDivisors', () => {
  it('divides by 1e6 when divisor is "1e6"', () => {
    const rows = [{ ts: 1, val: '2000000' }]
    const { rows: merged } = mergeDatasets([{
      id: 'a', rows, xField: 'ts', yFields: ['val'],
      colDivisors: { val: '1e6' }, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
    }])
    expect(merged[0].d0_val).toBeCloseTo(2, 5)
  })

  it('divides by 1e18 when divisor is "1e18"', () => {
    const rows = [{ ts: 1, val: '1000000000000000000' }]
    const { rows: merged } = mergeDatasets([{
      id: 'a', rows, xField: 'ts', yFields: ['val'],
      colDivisors: { val: '1e18' }, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
    }])
    expect(merged[0].d0_val).toBeCloseTo(1, 5)
  })

  it('raw divisor returns numeric value unchanged', () => {
    const rows = [{ ts: 1, val: 42 }]
    const { rows: merged } = mergeDatasets([{
      id: 'a', rows, xField: 'ts', yFields: ['val'],
      colDivisors: { val: 'raw' }, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
    }])
    expect(merged[0].d0_val).toBe(42)
  })
})

// ─── two datasets — union join ────────────────────────────────────────────────

describe('mergeDatasets — two datasets, union join', () => {
  // Dataset A has Jan 15, Jan 16
  // Dataset B has Jan 16, Jan 17
  // Union = Jan 15, Jan 16, Jan 17
  const dsA = {
    id: 'a',
    rows: [
      { ts: DAY_JAN15, revenue: 100 },
      { ts: DAY_JAN16, revenue: 200 },
    ],
    xField: 'ts', yFields: ['revenue'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }
  const dsB = {
    id: 'b',
    rows: [
      { ts: DAY_JAN16, cost: 50 },
      { ts: DAY_JAN17, cost: 80 },
    ],
    xField: 'ts', yFields: ['cost'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }

  it('produces union of all x keys', () => {
    const { xKeys } = mergeDatasets([dsA, dsB])
    expect(xKeys).toHaveLength(3)
    expect(xKeys).toEqual([DAY_JAN15, DAY_JAN16, DAY_JAN17])
  })

  it('fills null for missing buckets in each dataset', () => {
    const { rows } = mergeDatasets([dsA, dsB])
    // Jan 15: A has revenue, B has no cost → null
    expect(rows[0]).toMatchObject({ x: DAY_JAN15, d0_revenue: 100, d1_cost: null })
    // Jan 16: both have data
    expect(rows[1]).toMatchObject({ x: DAY_JAN16, d0_revenue: 200, d1_cost: 50 })
    // Jan 17: A has no revenue → null, B has cost
    expect(rows[2]).toMatchObject({ x: DAY_JAN17, d0_revenue: null, d1_cost: 80 })
  })

  it('uses d0_ prefix for first dataset, d1_ for second', () => {
    const { rows } = mergeDatasets([dsA, dsB])
    expect(rows[1]).toHaveProperty('d0_revenue')
    expect(rows[1]).toHaveProperty('d1_cost')
  })

  it('correctly builds seriesKeys for both datasets', () => {
    const { seriesKeys } = mergeDatasets([dsA, dsB])
    expect(seriesKeys['0:revenue']).toBe('d0_revenue')
    expect(seriesKeys['1:cost']).toBe('d1_cost')
  })
})

// ─── two datasets — same column name collision ────────────────────────────────

describe('mergeDatasets — same column name in two datasets', () => {
  const dsA = {
    id: 'a',
    rows: [{ ts: DAY_JAN15, val: 10 }],
    xField: 'ts', yFields: ['val'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }
  const dsB = {
    id: 'b',
    rows: [{ ts: DAY_JAN15, val: 99 }],
    xField: 'ts', yFields: ['val'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }

  it('prefixes prevent collisions: d0_val and d1_val are independent', () => {
    const { rows } = mergeDatasets([dsA, dsB])
    expect(rows[0].d0_val).toBe(10)
    expect(rows[0].d1_val).toBe(99)
  })
})

// ─── two datasets — type-compatible X alignment ───────────────────────────────

describe('mergeDatasets — type-compatible X alignment (the core feature)', () => {
  // Dataset A: intra-day timestamps on Jan 15 at different hours
  // Dataset B: just a single point at exactly midnight Jan 15
  // Both bucketed to 'day' → should align on the same bucket key
  const dsA = {
    id: 'a',
    rows: [
      { ts: DAY_JAN15 + 3600,  revenue: 50 },  // 1am UTC Jan 15
      { ts: DAY_JAN15 + 7200,  revenue: 50 },  // 2am UTC Jan 15
    ],
    xField: 'ts', yFields: ['revenue'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }
  const dsB = {
    id: 'b',
    rows: [
      { ts: DAY_JAN15 + 43200, cost: 30 },  // noon UTC Jan 15
    ],
    xField: 'ts', yFields: ['cost'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }

  it('aligns intra-day timestamps from both datasets to the same day bucket', () => {
    const { xKeys, rows } = mergeDatasets([dsA, dsB])
    expect(xKeys).toHaveLength(1)
    expect(xKeys[0]).toBe(DAY_JAN15)
    expect(rows[0].d0_revenue).toBe(100)
    expect(rows[0].d1_cost).toBe(30)
  })

  it('handles cross-month alignment', () => {
    const dsJan = {
      id: 'jan', rows: [{ ts: DAY_JAN15, v: 1 }],
      xField: 'ts', yFields: ['v'], colDivisors: {}, groupBy: 'month', aggregation: 'sum', yMode: 'raw',
    }
    const dsFeb = {
      id: 'feb', rows: [{ ts: DAY_FEB01, v: 2 }],
      xField: 'ts', yFields: ['v'], colDivisors: {}, groupBy: 'month', aggregation: 'sum', yMode: 'raw',
    }
    const { xKeys, rows } = mergeDatasets([dsJan, dsFeb])
    expect(xKeys).toHaveLength(2)
    expect(rows[0]).toMatchObject({ d0_v: 1, d1_v: null })
    expect(rows[1]).toMatchObject({ d0_v: null, d1_v: 2 })
  })
})

// ─── two datasets — independent cumulative ────────────────────────────────────

describe('mergeDatasets — cumulative per dataset', () => {
  // Dataset A is cumulative, dataset B is raw
  const dsA = {
    id: 'a',
    rows: [
      { ts: DAY_JAN15, val: 10 },
      { ts: DAY_JAN16, val: 20 },
    ],
    xField: 'ts', yFields: ['val'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'cumulative',
  }
  const dsB = {
    id: 'b',
    rows: [
      { ts: DAY_JAN15, cost: 5 },
      { ts: DAY_JAN16, cost: 7 },
    ],
    xField: 'ts', yFields: ['cost'],
    colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
  }

  it('cumulates A independently while B stays raw', () => {
    const { rows } = mergeDatasets([dsA, dsB])
    expect(rows[0].d0_val).toBe(10)
    expect(rows[1].d0_val).toBe(30)  // cumulative
    expect(rows[0].d1_cost).toBe(5)
    expect(rows[1].d1_cost).toBe(7)  // raw
  })
})

// ─── multiple datasets ────────────────────────────────────────────────────────

describe('mergeDatasets — three datasets', () => {
  const make = (id, dsIdx, ts, val) => ({
    id,
    rows: [{ ts, val }],
    xField: 'ts', yFields: ['val'],
    colDivisors: {}, groupBy: 'none', aggregation: 'sum', yMode: 'raw',
  })
  const ds0 = make('a', 0, 1, 10)
  const ds1 = make('b', 1, 2, 20)
  const ds2 = make('c', 2, 3, 30)

  it('produces three prefixed columns', () => {
    const { rows } = mergeDatasets([ds0, ds1, ds2])
    expect(rows[0]).toMatchObject({ d0_val: 10, d1_val: null, d2_val: null })
    expect(rows[1]).toMatchObject({ d0_val: null, d1_val: 20, d2_val: null })
    expect(rows[2]).toMatchObject({ d0_val: null, d1_val: null, d2_val: 30 })
  })
})

// ─── cumulative gap fix (BUG 4) ───────────────────────────────────────────────
// When dataset A has keys [Jan15, Jan17] and dataset B has keys [Jan16], the
// union xKeys = [Jan15, Jan16, Jan17]. Before the fix, A's cumulative output
// at Jan16 was null (visual gap) even though the running total should carry
// forward. After the fix, A emits the current running total at every union key.

describe('mergeDatasets — cumulative mode carries forward over missing keys', () => {
  it('fills carried-forward running total at keys absent from the dataset', () => {
    // Dataset A: data at Jan15 and Jan17 only (Jan16 missing)
    // Dataset B: data at Jan16 only (forces Jan16 into the union xKeys)
    const dsA = {
      id: 'a',
      rows: [
        { ts: DAY_JAN15, val: 10 },
        { ts: DAY_JAN17, val: 20 },
      ],
      xField: 'ts', yFields: ['val'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'cumulative',
    }
    const dsB = {
      id: 'b',
      rows: [{ ts: DAY_JAN16, other: 5 }],
      xField: 'ts', yFields: ['other'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
    }
    const { rows } = mergeDatasets([dsA, dsB])
    // Jan15: cumulative = 10
    expect(rows[0].d0_val).toBe(10)
    // Jan16: A has no data here — running total should carry forward (10), not null
    expect(rows[1].d0_val).toBe(10)
    // Jan17: cumulative = 10 + 20 = 30
    expect(rows[2].d0_val).toBe(30)
  })

  it('does NOT fill null for raw mode (gaps remain null)', () => {
    const dsA = {
      id: 'a',
      rows: [
        { ts: DAY_JAN15, val: 10 },
        { ts: DAY_JAN17, val: 20 },
      ],
      xField: 'ts', yFields: ['val'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
    }
    const dsB = {
      id: 'b',
      rows: [{ ts: DAY_JAN16, other: 5 }],
      xField: 'ts', yFields: ['other'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'raw',
    }
    const { rows } = mergeDatasets([dsA, dsB])
    // Jan16: raw mode — A has no data here, stays null
    expect(rows[1].d0_val).toBeNull()
  })

  it('handles a single dataset with all contiguous keys (no gap) correctly', () => {
    const ds = {
      id: 'a',
      rows: [
        { ts: DAY_JAN15, val: 5 },
        { ts: DAY_JAN16, val: 10 },
        { ts: DAY_JAN17, val: 15 },
      ],
      xField: 'ts', yFields: ['val'],
      colDivisors: {}, groupBy: 'day', aggregation: 'sum', yMode: 'cumulative',
    }
    const { rows } = mergeDatasets([ds])
    expect(rows[0].d0_val).toBe(5)
    expect(rows[1].d0_val).toBe(15)
    expect(rows[2].d0_val).toBe(30)
  })
})

// ─── formatXLabel ─────────────────────────────────────────────────────────────

describe('formatXLabel', () => {
  it('formats a day bucket key as "Jan 15, 2024"', () => {
    const label = formatXLabel(DAY_JAN15, 'day')
    expect(label).toContain('2024')
    expect(label).toContain('Jan')
    expect(label).toContain('15')
  })

  it('formats a month bucket key as "Jan 2024" (no day)', () => {
    const label = formatXLabel(MONTH_JAN, 'month')
    expect(label).toContain('2024')
    expect(label).toContain('Jan')
    // Month format should not include a day number for "month" groupBy
    expect(label).not.toMatch(/\b15\b/)
  })

  it('returns the raw string for non-timestamp keys', () => {
    expect(formatXLabel('ethereum', 'none')).toBe('ethereum')
    expect(formatXLabel(42, 'none')).toBe('42')  // small number, not a unix ts
  })

  it('returns string for a year-2000 epoch boundary (946684800)', () => {
    // Exactly at the boundary — treated as a timestamp
    const label = formatXLabel(946684801, 'day')
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThan(0)
  })
})
