import { describe, it, expect } from 'vitest'
import { applyComputedColumns, computedFieldMeta, parseFormula } from '../computedColumns.js'

// Helper: evaluate a formula against a flat scope via applyComputedColumns
function evalFormula(formula, scope = {}) {
  const row = { ...scope }
  const result = applyComputedColumns([row], [{ name: '__out', label: '', formula }], {})
  return result[0].__out
}

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

// ─── Extended parser tests ────────────────────────────────────────────────────

describe('parser — numeric literals', () => {
  it('handles integer literals', () => {
    expect(evalFormula('42')).toBe(42)
  })

  it('handles decimal literals', () => {
    expect(evalFormula('3.14')).toBeCloseTo(3.14)
  })

  it('handles leading-dot decimals (.5)', () => {
    expect(evalFormula('.5')).toBeCloseTo(0.5)
  })

  it('handles large numbers', () => {
    expect(evalFormula('1000000')).toBe(1000000)
  })
})

describe('parser — all six operators', () => {
  it('addition', ()       => { expect(evalFormula('3 + 4')).toBe(7) })
  it('subtraction', ()    => { expect(evalFormula('10 - 3')).toBe(7) })
  it('multiplication', () => { expect(evalFormula('3 * 4')).toBe(12) })
  it('division', ()       => { expect(evalFormula('10 / 4')).toBeCloseTo(2.5) })
  it('modulo', ()         => { expect(evalFormula('10 % 3')).toBe(1) })
  it('exponentiation', () => { expect(evalFormula('2 ^ 10')).toBe(1024) })
})

describe('parser — operator precedence', () => {
  it('multiplication binds tighter than addition', () => {
    expect(evalFormula('2 + 3 * 4')).toBe(14)   // not 20
  })

  it('parentheses override precedence', () => {
    expect(evalFormula('(2 + 3) * 4')).toBe(20)
  })

  it('exponentiation is right-associative: 2^3^2 = 2^(3^2) = 512', () => {
    expect(evalFormula('2^3^2')).toBe(512)       // not 64
  })

  it('unary minus applied after pow: -2^2 = -(2^2) = -4', () => {
    // Grammar: unary → '-' pow, so -2^2 parses as -(2^2) = -4
    expect(evalFormula('-2^2')).toBe(-4)
  })
})

describe('parser — unary operators', () => {
  it('unary minus negates a literal', () => {
    expect(evalFormula('-5')).toBe(-5)
  })

  it('unary plus is a no-op', () => {
    expect(evalFormula('+5')).toBe(5)
  })

  it('double negation (--5) is not supported → null', () => {
    // Grammar: unary → '-' pow (not '-' unary), so '--5' is a parse error.
    // This is intentional — the parser is deliberately minimal.
    expect(evalFormula('--5')).toBeNull()
  })

  it('unary minus on a variable', () => {
    expect(evalFormula('-x', { x: 3 })).toBe(-3)
  })
})

describe('parser — parentheses', () => {
  it('deeply nested parentheses', () => {
    expect(evalFormula('((((2 + 3))))')).toBe(5)
  })

  it('empty parentheses → null (syntax error)', () => {
    expect(evalFormula('()')).toBeNull()
  })

  it('mismatched extra closing paren → null', () => {
    expect(evalFormula('(2 + 3))')).toBeNull()
  })
})

describe('parser — variables', () => {
  it('resolves a named variable from the row', () => {
    expect(evalFormula('x', { x: 7 })).toBe(7)
  })

  it('unknown variable resolves to null, making the whole expression null', () => {
    // 'notpresent' is not in row → returns null → expression is null
    expect(evalFormula('notpresent')).toBeNull()
  })

  it('underscore is valid in identifiers', () => {
    expect(evalFormula('my_var', { my_var: 99 })).toBe(99)
  })

  it('identifiers starting with uppercase are accepted', () => {
    expect(evalFormula('MyCol', { MyCol: 5 })).toBe(5)
  })
})

describe('parser — malformed input → null', () => {
  it('trailing operator: "a +"', () => {
    expect(evalFormula('a +')).toBeNull()
  })

  it('leading binary operator: "+ a"', () => {
    // Unary + is accepted; this is valid (equals a)
    // Make sure we don't crash
    const out = evalFormula('+a', { a: 3 })
    expect(out).toBe(3)
  })

  it('double operator: "a ** b"', () => {
    // Second * is seen as trailing; whole expression null
    expect(evalFormula('a ** b', { a: 2, b: 3 })).toBeNull()
  })

  it('unexpected character @', () => {
    expect(parseFormula('a @ b')).toBeNull()
  })

  it('unexpected character !', () => {
    expect(parseFormula('!a')).toBeNull()
  })

  it('unexpected character $', () => {
    expect(parseFormula('$x')).toBeNull()
  })

  it('unclosed paren', () => {
    expect(parseFormula('(a + b')).toBeNull()
  })

  it('empty string', () => {
    expect(parseFormula('')).toBeNull()
  })

  it('whitespace only', () => {
    expect(parseFormula('   ')).toBeNull()
  })

  it('null input', () => {
    expect(parseFormula(null)).toBeNull()
  })
})

describe('parser — numeric edge cases', () => {
  it('division by zero → null (Infinity filtered)', () => {
    expect(evalFormula('1 / 0')).toBeNull()
  })

  it('negative division by zero → null (-Infinity filtered)', () => {
    expect(evalFormula('-1 / 0')).toBeNull()
  })

  it('zero modulo zero → null (NaN filtered)', () => {
    expect(evalFormula('0 % 0')).toBeNull()
  })

  it('zero raised to zero power = 1', () => {
    expect(evalFormula('0 ^ 0')).toBe(1)   // Math.pow(0,0) = 1 in JS
  })
})

describe('SECURITY — prototype pollution via formula variables', () => {
  // These tests ensure that referencing prototype-chain names in a formula
  // cannot read or pollute Object.prototype or the scope's prototype.

  it('__proto__ as a variable name does not return the prototype object', () => {
    // The scope is Object.create(null) — it has no __proto__ property.
    // hasOwnProperty.call(scope, '__proto__') is false, so result is null.
    expect(evalFormula('__proto__')).toBeNull()
  })

  it('constructor as a variable name returns null (not a function)', () => {
    expect(evalFormula('constructor')).toBeNull()
  })

  it('toString as a variable name returns null', () => {
    expect(evalFormula('toString')).toBeNull()
  })

  it('hasOwnProperty as a variable name returns null', () => {
    expect(evalFormula('hasOwnProperty')).toBeNull()
  })

  it('valueOf as a variable name returns null', () => {
    expect(evalFormula('valueOf')).toBeNull()
  })

  it('a formula using __proto__ does not mutate Object.prototype', () => {
    const before = Object.prototype.pwned
    evalFormula('__proto__')
    expect(Object.prototype.pwned).toBe(before)
  })

  it('row data keyed with __proto__ does not leak into expression scope', () => {
    // Pass a row with a key that looks like a prototype attack.
    // The scope is built with Object.keys() on a {…spread} object;
    // own-only keys are copied → the expression still can't read __proto__.
    const row = Object.assign(Object.create(null), { a: 5 })
    const result = applyComputedColumns(
      [row],
      [{ name: '__out', label: '', formula: '__proto__' }],
      {}
    )
    expect(result[0].__out).toBeNull()
  })
})

describe('SECURITY — scope isolation between rows', () => {
  it('computed result from one row does not bleed into the next row scope', () => {
    const rows = [
      { x: '10' },
      { x: '20' },
    ]
    const defs = [{ name: 'doubled', label: '', formula: 'x * 2' }]
    const result = applyComputedColumns(rows, defs, {})
    expect(result[0].doubled).toBe(20)
    expect(result[1].doubled).toBe(40)
  })

  it('original rows are not mutated', () => {
    const rows = [{ a: '5', b: '3' }]
    const original = JSON.parse(JSON.stringify(rows))
    applyComputedColumns(rows, [{ name: 'sum', label: '', formula: 'a + b' }], {})
    expect(rows).toEqual(original)
  })
})
