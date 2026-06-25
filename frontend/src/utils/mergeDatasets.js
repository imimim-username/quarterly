/**
 * mergeDatasets.js
 *
 * Utility for union-joining multiple independently-bucketed datasets on a
 * shared X axis (usually a unix-timestamp field) so they can be rendered
 * as a single ECharts series set.
 *
 * X-axis values are type-compatible but do NOT have to match exactly:
 * both datasets are bucketed with the same groupBy before joining, so a
 * "day" bucket in dataset A will align with the same "day" bucket in B
 * even if the underlying raw timestamps differ.
 */

// ─── re-implemented helpers (mirrors ResultsChart.jsx) ────────────────────────

function applyDivisorNumeric(value, divisor) {
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

function bucketTimestamp(ts, groupBy) {
  const d = new Date(Number(ts) * 1000)
  if (groupBy === 'day')   return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
  if (groupBy === 'week')  return Math.floor(Number(ts) / 604800) * 604800
  if (groupBy === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  return Number(ts)
}

function aggregate(values, method) {
  const nums = values.filter(v => v !== null && !isNaN(v))
  if (nums.length === 0) return null
  switch (method) {
    case 'avg':    return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
    case 'min':   return Math.min(...nums)
    case 'max':   return Math.max(...nums)
    case 'count': return nums.length
    case 'sum':
    default:      return nums.reduce((a, b) => a + b, 0)
  }
}

/**
 * Bucket a single dataset's rows into `{ [bucketKey]: { [field]: number[] } }`.
 *
 * @param {object[]} rows         Raw row objects from a run
 * @param {string}   xField       Column used as the X axis
 * @param {string[]} yFields      Columns used as Y series
 * @param {object}   colDivisors  { [col]: 'raw' | '1e6' | '1e18' }
 * @param {string}   groupBy      'none' | 'day' | 'week' | 'month'
 * @returns {Map<number|string, object>}  Map from bucketKey → aggregated value object
 */
function bucketDataset(rows, xField, yFields, colDivisors, groupBy) {
  const map = new Map()
  const bucketKey = groupBy === 'none'
    ? row => row[xField]
    : row => bucketTimestamp(row[xField], groupBy)

  for (const row of rows) {
    const key = bucketKey(row)
    if (key == null) continue
    if (!map.has(key)) map.set(key, Object.fromEntries(yFields.map(f => [f, []])))
    const entry = map.get(key)
    for (const f of yFields) {
      const v = applyDivisorNumeric(row[f], colDivisors?.[f])
      if (v !== null && !isNaN(v)) entry[f].push(v)
    }
  }
  return map
}

// ─── main export ──────────────────────────────────────────────────────────────

/**
 * Merge multiple datasets into a single flat row array suitable for ECharts.
 *
 * Each dataset is described by:
 *   { id, rows, xField, yFields, colDivisors, groupBy, aggregation, yMode }
 *
 * Returns:
 *   {
 *     xKeys: (number|string)[],          // sorted union of all bucket keys
 *     rows:  object[],                   // { x, d0_field, d1_field, ... }
 *     seriesKeys: { [dsId_field]: string }  // maps series key → display key
 *   }
 *
 * Series keys are prefixed `d{index}_` so multiple datasets with the same
 * column name don't collide, e.g. `d0_value`, `d1_value`.
 */
export function mergeDatasets(datasets) {
  if (!datasets || datasets.length === 0) return { xKeys: [], rows: [], seriesKeys: {} }

  // 1. Bucket each dataset independently
  const bucketed = datasets.map(ds => ({
    ds,
    map: bucketDataset(
      ds.rows ?? [],
      ds.xField,
      ds.yFields ?? [],
      ds.colDivisors ?? {},
      ds.groupBy ?? 'day',
    ),
  }))

  // 2. Union all bucket keys across all datasets
  const allKeys = new Set()
  for (const { map } of bucketed) {
    for (const k of map.keys()) allKeys.add(k)
  }

  // 3. Sort keys (numeric if possible, string otherwise)
  const xKeys = [...allKeys].sort((a, b) => {
    const an = Number(a), bn = Number(b)
    if (!isNaN(an) && !isNaN(bn)) return an - bn
    return String(a).localeCompare(String(b))
  })

  // 4. For each dataset, aggregate its buckets and optionally cumulate
  const aggregated = bucketed.map(({ ds, map }) => {
    const aggMap = new Map()
    for (const [key, arrays] of map.entries()) {
      const point = {}
      for (const f of ds.yFields ?? []) {
        point[f] = aggregate(arrays[f], ds.aggregation ?? 'sum')
      }
      aggMap.set(key, point)
    }

    if (ds.yMode === 'cumulative') {
      const running = Object.fromEntries((ds.yFields ?? []).map(f => [f, 0]))
      // iterate in sorted key order
      for (const key of xKeys) {
        if (aggMap.has(key)) {
          const point = aggMap.get(key)
          for (const f of ds.yFields ?? []) {
            running[f] += point[f] ?? 0
            point[f] = running[f]
          }
        }
      }
    }

    return aggMap
  })

  // 5. Build merged row array: { x: key, d0_field: val, d1_field: val, ... }
  const rows = xKeys.map(key => {
    const row = { x: key }
    bucketed.forEach(({ ds }, idx) => {
      const point = aggregated[idx].get(key)
      for (const f of ds.yFields ?? []) {
        row[`d${idx}_${f}`] = point?.[f] ?? null
      }
    })
    return row
  })

  // 6. Build a seriesKeys map for callers: dataset-index + field → merged key
  const seriesKeys = {}
  bucketed.forEach(({ ds }, idx) => {
    for (const f of ds.yFields ?? []) {
      seriesKeys[`${idx}:${f}`] = `d${idx}_${f}`
    }
  })

  return { xKeys, rows, seriesKeys }
}

/**
 * Format a bucket key as a human-readable X-axis label.
 * If the key looks like a unix timestamp (>= year 2000 in seconds), format as date.
 */
export function formatXLabel(key, groupBy) {
  const num = Number(key)
  if (!isNaN(num) && num > 946684800) { // after year 2000
    const d = new Date(num * 1000)
    if (groupBy === 'month') {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' })
    }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return String(key)
}
