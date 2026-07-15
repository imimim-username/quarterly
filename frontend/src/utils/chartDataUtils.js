/**
 * chartDataUtils.js
 *
 * Pure data-transformation functions for chart building.
 * Extracted from ReportInstanceCard so they can be unit-tested independently
 * of any React or ECharts dependencies.
 */

/**
 * Apply a divisor (raw / 1e6 / 1e18) to a raw cell value, returning a Number.
 * Uses BigInt arithmetic for 1e6/1e18 to avoid float precision loss.
 */
export function applyDivisorNumeric(value, divisor) {
  if (value === null || value === undefined || value === '') return null
  if (!divisor || divisor === 'raw' || divisor === 'datetime') return Number(value)
  try {
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    return Number(raw / pow) + Number(raw % pow) / Number(pow)
  } catch { return Number(value) }
}

/**
 * Bucket a Unix-second timestamp into a day / week / month bucket.
 * Returns the bucket's anchor timestamp (Unix seconds).
 */
export function bucketTimestamp(ts, groupBy) {
  const d = new Date(Number(ts) * 1000)
  if (groupBy === 'day')   return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
  if (groupBy === 'week')  return Math.floor(Number(ts) / 604800) * 604800
  if (groupBy === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  return Number(ts)
}

/**
 * Aggregate an array of numbers with the given method.
 * Null / NaN values are excluded before aggregation.
 */
export function aggregate(values, method) {
  const nums = values.filter(v => v !== null && !isNaN(v))
  if (!nums.length) return null
  switch (method) {
    case 'avg':    return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'median': {
      const s = [...nums].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
    }
    case 'min':   return Math.min(...nums)
    case 'max':   return Math.max(...nums)
    case 'count': return nums.length
    default:      return nums.reduce((a, b) => a + b, 0)  // sum
  }
}

/**
 * Build chart-ready data from raw query result rows.
 *
 * @param {object[]} rows        - Raw result rows from the server.
 * @param {string}   xField      - Column to use as the X axis.
 * @param {string[]} yFields     - Columns to plot on the Y axis.
 * @param {object}   colDivisors - { [col]: 'raw'|'1e6'|'1e18' } divisors per column.
 * @param {string}   groupBy     - 'none'|'day'|'week'|'month'
 * @param {string}   yMode       - 'raw'|'cumulative'
 * @param {string}   aggregation - 'sum'|'avg'|'median'|'min'|'max'|'count'
 * @param {string}   xSortDir    - 'asc'|'desc'
 * @returns {object[]} Array of { x, [field]: value, ... } data points.
 */
export function buildChartData(rows, xField, yFields, colDivisors, groupBy, yMode, aggregation, xSortDir = 'asc') {
  if (!rows?.length || !xField || !yFields.length) return []

  const bucketKey = groupBy === 'none'
    ? r => r[xField]
    : r => bucketTimestamp(r[xField], groupBy)

  const map = new Map()
  for (const row of rows) {
    const key = bucketKey(row)
    if (!map.has(key)) map.set(key, Object.fromEntries(yFields.map(f => [f, []])))
    const entry = map.get(key)
    for (const f of yFields) {
      const v = applyDivisorNumeric(row[f], colDivisors[f])
      if (v !== null && !isNaN(v)) entry[f].push(v)
    }
  }

  let data = [...map.entries()].map(([key, arrs]) => {
    const p = { x: key }
    for (const f of yFields) p[f] = aggregate(arrs[f], aggregation)
    return p
  })

  data.sort((a, b) => {
    const an = Number(a.x), bn = Number(b.x)
    return (!isNaN(an) && !isNaN(bn)) ? an - bn : String(a.x).localeCompare(String(b.x))
  })
  if (xSortDir === 'desc') data.reverse()

  if (yMode === 'cumulative') {
    const running = Object.fromEntries(yFields.map(f => [f, 0]))
    data = data.map(p => {
      const q = { ...p }
      for (const f of yFields) { running[f] += (q[f] ?? 0); q[f] = running[f] }
      return q
    })
  }

  return data
}

/**
 * Format a Y-axis value with K / M / B / T suffix.
 */
export function fmtAxisVal(val) {
  const abs = Math.abs(val)
  if (abs >= 1e12) return `${+(val / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${+(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${+(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${+(val / 1e3).toFixed(2)}K`
  return String(val)
}

/**
 * Format an X-axis label, detecting timestamps and grouped buckets.
 */
export function fmtXLabel(val, groupBy, xField) {
  if (groupBy !== 'none') {
    const d = new Date(Number(val) * 1000)
    if (groupBy === 'month') return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' })
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  const n = Number(val)
  if (!isNaN(n) && n > 1e9 && n < 2e10) return new Date(n * 1000).toLocaleDateString()
  return String(val)
}
