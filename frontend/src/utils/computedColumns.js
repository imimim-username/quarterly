/**
 * computedColumns.js
 *
 * Evaluates user-defined formula columns against result rows.
 *
 * Each column definition:
 *   { name: string, label: string, formula: string }
 *
 * SECURITY: This module uses a hand-written recursive-descent arithmetic parser.
 * - No eval(), no Function(), no external parser library.
 * - Variable lookup uses Object.prototype.hasOwnProperty.call() to prevent
 *   prototype-chain access (prototype pollution defence).
 * - Scope objects are created with Object.create(null) (no prototype at all).
 * - Only arithmetic is supported: + - * / % ^ unary-minus ( ) numeric literals
 *   identifier variables. No function calls, no string ops, no assignments.
 *
 * Why not expr-eval?
 *   expr-eval <= 2.0.2 has two unpatched CVEs (prototype pollution CVE-2025-13204
 *   and RCE CVE-2025-12735, CVSS 9.8) and the package is unmaintained since 2019.
 */

// ─── Token types ─────────────────────────────────────────────────────────────

const T_NUM = 'n' // numeric literal
const T_VAR = 'v' // identifier / variable
const T_OP  = 'o' // operator or parenthesis

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Lex `expr` into a flat token array.
 * Returns null if an unexpected character is found.
 */
function tokenize(expr) {
  const tokens = []
  let i = 0
  const len = expr.length

  while (i < len) {
    const ch = expr[i]

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue }

    // Numeric literal (integers and decimals, e.g. 42, 3.14)
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let s = ''
      let seenDot = false
      while (i < len) {
        const c = expr[i]
        if (c >= '0' && c <= '9') { s += c; i++ }
        else if (c === '.' && !seenDot) { s += c; seenDot = true; i++ }
        else break
      }
      const v = parseFloat(s)
      if (isNaN(v)) return null
      tokens.push({ t: T_NUM, v })
      continue
    }

    // Identifier / variable name  ([A-Za-z_][A-Za-z0-9_]*)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let s = ''
      while (i < len) {
        const c = expr[i]
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c === '_') { s += c; i++ }
        else break
      }
      tokens.push({ t: T_VAR, v: s })
      continue
    }

    // Operators and parentheses
    if ('+-*/%^()'.indexOf(ch) !== -1) { tokens.push({ t: T_OP, v: ch }); i++; continue }

    return null // unexpected character → lex error
  }

  return tokens
}

// ─── Recursive-descent evaluator ─────────────────────────────────────────────
//
// Grammar (standard arithmetic precedence):
//   expr    → addSub
//   addSub  → mulDiv ( ('+'|'-') mulDiv )*
//   mulDiv  → unary  ( ('*'|'/'|'%') unary )*
//   unary   → ('-'|'+') pow | pow
//   pow     → primary ('^' unary)?        // right-associative
//   primary → NUMBER | IDENT | '(' expr ')'

function evalTokens(tokens, scope) {
  let pos = 0

  const peek = () => (pos < tokens.length ? tokens[pos] : null)
  const next = () => tokens[pos++]

  function expr()   { return addSub() }

  function addSub() {
    let v = mulDiv()
    if (v === null) return null
    for (;;) {
      const t = peek()
      if (!t || t.t !== T_OP || (t.v !== '+' && t.v !== '-')) break
      next()
      const r = mulDiv()
      if (r === null) return null
      v = t.v === '+' ? v + r : v - r
    }
    return v
  }

  function mulDiv() {
    let v = unary()
    if (v === null) return null
    for (;;) {
      const t = peek()
      if (!t || t.t !== T_OP || (t.v !== '*' && t.v !== '/' && t.v !== '%')) break
      next()
      const r = unary()
      if (r === null) return null
      v = t.v === '*' ? v * r : t.v === '/' ? v / r : v % r
    }
    return v
  }

  function unary() {
    const t = peek()
    if (t && t.t === T_OP && t.v === '-') { next(); const v = pow(); return v === null ? null : -v }
    if (t && t.t === T_OP && t.v === '+') { next(); return pow() }
    return pow()
  }

  function pow() {
    const base = primary()
    if (base === null) return null
    const t = peek()
    if (t && t.t === T_OP && t.v === '^') {
      next()
      const exp = unary() // right-associative: 2^3^2 = 2^(3^2) = 512
      if (exp === null) return null
      return Math.pow(base, exp)
    }
    return base
  }

  function primary() {
    const t = peek()
    if (!t) return null

    if (t.t === T_NUM) { next(); return t.v }

    if (t.t === T_VAR) {
      next()
      // hasOwnProperty guard prevents prototype-chain traversal
      return Object.prototype.hasOwnProperty.call(scope, t.v) ? scope[t.v] : null
    }

    if (t.t === T_OP && t.v === '(') {
      next()
      const v = expr()
      const closing = peek()
      if (!closing || closing.t !== T_OP || closing.v !== ')') return null // unclosed paren
      next()
      return v
    }

    return null
  }

  const result = expr()
  // If we didn't consume all tokens (e.g. trailing garbage), it's a syntax error
  return pos === tokens.length ? result : null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a formula string.
 * Returns the formula string if syntactically valid, null otherwise.
 * Used for live validation in ComputedColumnsEditor (no scope needed).
 */
export function parseFormula(formula) {
  if (!formula || typeof formula !== 'string' || !formula.trim()) return null
  const tokens = tokenize(formula.trim())
  if (!tokens || tokens.length === 0) return null
  // Validate by evaluating with every referenced variable set to 1.
  // This ensures a numeric result even before real data is available.
  const scope = Object.create(null)
  for (const tok of tokens) if (tok.t === T_VAR) scope[tok.v] = 1
  return evalTokens(tokens, scope) !== null ? formula : null
}

/**
 * Apply divisor to a raw cell value, returning a Number.
 * Mirrors applyDivisorNumeric in ResultsChart — duplicated here to keep
 * this utility self-contained and avoid a circular dependency.
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
 * Apply computed column definitions to an array of rows.
 *
 * @param {object[]} rows        — result rows (raw values from the server)
 * @param {object[]} defs        — column defs: [{ name, label, formula }]
 * @param {object}   colDivisors — { [col]: 'raw'|'1e6'|'1e18'|'datetime' }
 * @returns {object[]} new row objects with extra keys; originals are not mutated
 */
export function applyComputedColumns(rows, defs, colDivisors = {}) {
  if (!rows || rows.length === 0) return rows
  if (!Array.isArray(defs) || defs.length === 0) return rows

  // Pre-tokenize all formulas once so we don't lex on every row
  const compiled = defs.map(def => ({
    name: def.name,
    tokens: (def.formula && def.formula.trim()) ? tokenize(def.formula.trim()) : null,
  }))

  return rows.map(row => {
    const extended = { ...row }

    for (const { name, tokens } of compiled) {
      if (!tokens) { extended[name] = null; continue }

      // Build scope from the current extended row (so earlier computed cols are visible).
      // Use Object.create(null) to guarantee no prototype chain on the scope object.
      const scope = Object.create(null)
      for (const key of Object.keys(extended)) {
        const num = applyDivisor(extended[key], colDivisors[key])
        scope[key] = (num !== null && !isNaN(num)) ? num : 0
      }

      const result = evalTokens(tokens, scope)
      // Treat Infinity, -Infinity, NaN as null (e.g. division by zero)
      extended[name] = (typeof result === 'number' && isFinite(result)) ? result : null
    }

    return extended
  })
}

/**
 * Build fieldMeta entries for computed columns so their labels appear in
 * table headers and chart field selectors.
 *
 * @param {object[]} defs — computed column definitions
 * @returns {{ [name]: { label: string, computed: true } }}
 */
export function computedFieldMeta(defs) {
  const meta = {}
  for (const { name, label } of defs || []) {
    if (name) meta[name] = { label: label || name, computed: true }
  }
  return meta
}
