import { describe, it, expect } from 'vitest'
import { applyComputedColumns, computedFieldMeta, parseFormula } from '../computedColumns.js'

const ROWS = [
  { id: 1, volume: '1000000000000000000', price: '2' },   // volume=1e18, price=2
  { id: 2, volume: '500000000000000000',  price: '4' },   // volume=0.5e18, price=4
  { id: 3, volume: '0',                   price: '1' },
]

describe('parseFormula', () => {
  it('parses a valid formula', () => {
    expect(parseFormula('a + b')).not.toBeNull()
  })

  it('returns null for invalid syntax', () => {
    // Unclosed parenthesis — parser returns null
    expect(parseFormula('(a + b')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseFormula('')).toBeNull()
    expect(parseFormula('  ')).toBeNull()
  })
})

describe('applyComputedColumns — no defs', () => {
  it('returns rows unchanged when defs is empty', () => {
    const result = applyComputedColumns(ROWS, [], {})
    expect(result).toEqual(ROWS)
  })

  it('returns rows unchanged when defs is null/undefined', () => {
    expect(applyComputedColumns(ROWS, null, {})).toEqual(ROWS)
    expect(applyComputedColumns(ROWS, undefined, {})).toEqual(ROWS)
  })
})

describe('applyComputedColumns — simple arithmetic', () => {
  const defs = [{ name: 'total', label: 'Total', formula: 'volume + price' }]

  it('adds the computed column to each row', () => {
    const result = applyComputedColumns(ROWS, defs, {})
    expect(result[0]).toHaveProperty('total')
  })

  it('does not mutate original rows', () => {
    const original = ROWS.map(r => ({ ...r }))
    applyComputedColumns(ROWS, defs, {})
    expect(ROWS).toEqual(original)
  })

  it('applies divisors before evaluation', () => {
    // volume ÷ 1e18 = 1 for row[0], price is raw = 2 → ratio = 0.5
    const colDivisors = { volume: '1e18' }
    const ratioDefs = [{ name: 'ratio', label: 'Ratio', formula: 'volume / price' }]
    const result = applyComputedColumns(ROWS, ratioDefs, colDivisors)
    expect(result[0].ratio).toBeCloseTo(0.5)
    expect(result[1].ratio).toBeCloseTo(0.125)   // 0.5 / 4
  })

  it('evaluates zero correctly', () => {
    const ratioDefs = [{ name: 'ratio', label: 'Ratio', formula: 'volume / price' }]
    const result = applyComputedColumns(ROWS, ratioDefs, {})
    expect(result[2].ratio).toBe(0)              // 0 / 1 = 0
  })
})

describe('applyComputedColumns — chaining', () => {
  it('later columns can reference earlier computed columns', () => {
    const defs = [
      { name: 'doubled', label: 'Doubled', formula: 'price * 2' },
      { name: 'quadrupled', label: 'Quadrupled', formula: 'doubled * 2' },
    ]
    const result = applyComputedColumns(ROWS, defs, {})
    expect(result[0].doubled).toBe(4)       // price=2 * 2
    expect(result[0].quadrupled).toBe(8)    // doubled=4 * 2
  })
})

describe('applyComputedColumns — invalid formula', () => {
  it('produces null for an invalid formula', () => {
    const defs = [{ name: 'bad', label: 'Bad', formula: '(a + b' }]
    const result = applyComputedColumns(ROWS, defs, {})
    expect(result[0].bad).toBeNull()
  })

  it('produces null for division by zero', () => {
    const defs = [{ name: 'div', label: 'Div', formula: 'price / 0' }]
    const result = applyComputedColumns(ROWS, defs, {})
    // Infinity is not finite → null
    expect(result[0].div).toBeNull()
  })
})

describe('computedFieldMeta', () => {
  it('returns empty object for empty/null defs', () => {
    expect(computedFieldMeta([])).toEqual({})
    expect(computedFieldMeta(null)).toEqual({})
  })

  it('builds correct fieldMeta entries', () => {
    const defs = [
      { name: 'ratio', label: 'Ratio', formula: 'a / b' },
      { name: 'sum', label: '',        formula: 'a + b' },
    ]
    const meta = computedFieldMeta(defs)
    expect(meta.ratio).toEqual({ label: 'Ratio', computed: true })
    // empty label falls back to name
    expect(meta.sum).toEqual({ label: 'sum', computed: true })
  })
})
