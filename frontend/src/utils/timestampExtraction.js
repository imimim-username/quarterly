/**
 * timestampExtraction.js
 *
 * Extracts a Unix timestamp from an existing string field by splitting on a
 * delimiter and taking the fragment before or after it.
 *
 * Configuration shape (stored as timestamp_extraction on a query):
 *   {
 *     sourceField:  string  — field to split (e.g. "id")
 *     delimiter:    string  — split string (e.g. "/")
 *     position:     'before' | 'after'
 *     outputName:   string  — key for the new column (e.g. "parsed_timestamp")
 *     outputLabel:  string  — display label (e.g. "Timestamp")
 *   }
 *
 * The extracted value is treated as a Unix timestamp (same as other
 * datetime columns). It is available for computed column formulas, chart
 * axis selection, and client-side table sorting.
 */

/**
 * Add a virtual timestamp column to every row.
 *
 * @param {object[]} rows   — raw result rows
 * @param {object|null} config — timestamp_extraction config from the query
 * @returns {object[]} new row objects (originals not mutated)
 */
export function applyTimestampExtraction(rows, config) {
  if (!rows || rows.length === 0) return rows
  if (!config || !config.sourceField || !config.outputName || !config.delimiter) return rows

  const { sourceField, delimiter, position, outputName } = config

  return rows.map(row => {
    const raw = row[sourceField]
    if (raw == null) return { ...row, [outputName]: null }

    const str = String(raw)
    const idx = str.indexOf(delimiter)

    let fragment
    if (idx === -1) {
      // Delimiter not found — use the whole value
      fragment = str
    } else if (position === 'before') {
      fragment = str.slice(0, idx)
    } else {
      // 'after' (default)
      fragment = str.slice(idx + delimiter.length)
    }

    const num = Number(fragment.trim())
    return { ...row, [outputName]: isNaN(num) ? null : num }
  })
}

/**
 * Build a fieldMeta entry for the extracted column so it appears in table
 * headers, chart axis selectors, etc.
 *
 * @param {object|null} config
 * @returns {{ [outputName]: { label, computed, datetime } }}
 */
export function timestampExtractionMeta(config) {
  if (!config || !config.outputName) return {}
  return {
    [config.outputName]: {
      label: config.outputLabel || config.outputName,
      computed: true,
      // Signals to the app that this column should default to 'datetime' divisor
      datetime: true,
    },
  }
}
