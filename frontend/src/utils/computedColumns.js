/**
 * computedColumns.js
 *
 * Evaluates user-defined formula columns against result rows.
 *
 * Each column definition:
 *   { name: string, label: string, formula: string }
 *
 * - `name`    — the column key added to each row (used as variable name in other formulas)
 * - `label`   — display label shown in the table header / fieldMeta
 * - `formula` — arithmetic expression string; variables map to display values
 *                (i.e. values already divided by their colDivisors)
 *
 * Uses expr-eval for safe parsing — no eval / Function constructor.
 * Unknown variables evaluate to null (the row is skipped for that column).
 */

import { Parser } from 'expr-eval'

const parser = new Parser({
  operators: {
    add: true,
    subtract: true,
    multiply: true,
    divide: true,
    remainder: true,
    power: true,
    logical: false,
    comparison: false,
    bitwise: false,
    in: false,
    assignment: false,
  },
})

/**
 * Apply divisor to a raw cell value, returning a Number (same logic as
 * applyDivisorNumeric in ResultsChart, duplicated here to keep the util
 * self-contained and avoid a circular dependency).
 */
function applyDivisor(value, divisor) {
  if (value === null || value === undefined || value === '') return null
  if (!divisor || divisor === 'raw' || divisor === 'datetime') return Number(value)
  try {
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    return Number(raw / pow) + Number(raw % pow) / Number(pow)
  } catch {
    return Number(value)
  }
}

/**
 * Parse a formula string. Returns the parsed expression or null on error.
 * Exported so the editor can validate formulas as the user types.
 */
export function parseFormula(formula) {
  if (!formula || !formula.trim()) return null
  try {
    return parser.parse(formula.trim())
  } catch {
    return null
  }
}

/**
 * Apply all computed column definitions to an array of rows.
 *
 * @param {object[]} rows       — result rows (raw values from the server)
 * @param {object[]} defs       — computed column definitions [{name, label, formula}]
 * @param {object}   colDivisors — divisor map used to convert raw values to display values
 * @returns {object[]} new rows with extra keys added; original rows are not mutated
 */
export function applyComputedColumns(rows, defs, colDivisors = {}) {
  if (!rows || rows.length === 0) return rows
  if (!defs || defs.length === 0) return rows

  // Pre-parse all formulas once
  const parsed = defs.map(def => ({
    ...def,
    expr: parseFormula(def.formula),
  }))

  return rows.map(row => {
    const extended = { ...row }

    for (const { name, expr } of parsed) {
      if (!expr) {
        extended[name] = null
        continue
      }

      // Build variable scope: for every key in the (extended) row, supply the
      // display value (post-divisor). Already-computed columns in earlier
      // definitions are available to later ones.
      const scope = {}
      for (const key of Object.keys(extended)) {
        const raw = extended[key]
        const divisor = colDivisors[key]
        const num = applyDivisor(raw, divisor)
        scope[key] = num !== null && !isNaN(num) ? num : 0
      }

      try {
        const result = expr.evaluate(scope)
        extended[name] = typeof result === 'number' && isFinite(result) ? result : null
      } catch {
        extended[name] = null
      }
    }

    return extended
  })
}

/**
 * Build the fieldMeta entries for computed columns so they appear with the
 * right label in the table header and chart selectors.
 *
 * @param {object[]} defs — computed column definitions
 * @returns {object} partial fieldMeta object { [name]: { label, computed: true } }
 */
export function computedFieldMeta(defs) {
  const meta = {}
  for (const { name, label } of defs || []) {
    if (name) meta[name] = { label: label || name, computed: true }
  }
  return meta
}
