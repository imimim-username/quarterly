import React, { useMemo } from 'react'

/**
 * Check if a field is numeric for delta calculation.
 */
function isNumericField(col, fieldMeta, runA, runB) {
  const meta = fieldMeta?.[col]
  if (meta?.type === 'unix_seconds' || meta?.type === 'unix_ms' || meta?.type === 'iso8601' || meta?.type === 'id') return false
  if (meta?.decimals !== undefined) return true

  // Check if both runs' values parse as finite numbers within safe integer range
  const sampleA = runA.rows?.slice(0, 10).map(r => r[col]).filter(v => v !== null && v !== undefined) || []
  const sampleB = runB.rows?.slice(0, 10).map(r => r[col]).filter(v => v !== null && v !== undefined) || []
  const samples = [...sampleA, ...sampleB]
  if (samples.length === 0) return false
  return samples.every(v => Number.isFinite(parseFloat(v)) && parseFloat(v) <= Number.MAX_SAFE_INTEGER)
}

/**
 * CompareView — side-by-side tables with delta columns.
 * Rows matched by key_field.
 */
export default function CompareView({ runA, runB, keyField = 'id', fieldMeta = {} }) {
  const { matched, onlyA, onlyB, columns } = useMemo(() => {
    if (!runA?.rows || !runB?.rows) return { matched: [], onlyA: [], onlyB: [], columns: [] }

    const mapA = new Map()
    const mapB = new Map()
    const dupA = new Set()
    const dupB = new Set()

    for (const row of runA.rows) {
      const k = row[keyField]
      if (k === null || k === undefined) continue
      const ks = String(k)
      if (mapA.has(ks)) dupA.add(ks)
      else mapA.set(ks, row)
    }
    for (const row of runB.rows) {
      const k = row[keyField]
      if (k === null || k === undefined) continue
      const ks = String(k)
      if (mapB.has(ks)) dupB.add(ks)
      else mapB.set(ks, row)
    }

    const matched = []
    const onlyA = []
    const onlyB = []

    for (const [k, rowA] of mapA.entries()) {
      if (mapB.has(k)) {
        matched.push({ key: k, rowA, rowB: mapB.get(k), dupA: dupA.has(k), dupB: dupB.has(k) })
      } else {
        onlyA.push({ key: k, row: rowA })
      }
    }
    for (const [k, rowB] of mapB.entries()) {
      if (!mapA.has(k)) {
        onlyB.push({ key: k, row: rowB })
      }
    }

    // Columns from first run's first row
    const cols = []
    const seen = new Set()
    if (runA.rows.length > 0) {
      for (const col of Object.keys(runA.rows[0])) {
        if (!seen.has(col)) { cols.push(col); seen.add(col) }
      }
    }
    if (runB.rows.length > 0) {
      for (const col of Object.keys(runB.rows[0])) {
        if (!seen.has(col)) { cols.push(col); seen.add(col) }
      }
    }

    return { matched, onlyA, onlyB, columns: cols }
  }, [runA, runB, keyField])

  const numericCols = useMemo(
    () => columns.filter(c => isNumericField(c, fieldMeta, runA, runB)),
    [columns, fieldMeta, runA, runB]
  )

  const calcDelta = (col, a, b) => {
    const av = parseFloat(a?.[col])
    const bv = parseFloat(b?.[col])
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return '—'
    const diff = bv - av
    const pct = av !== 0 ? ((diff / Math.abs(av)) * 100).toFixed(1) + '%' : '—'
    const diffStr = diff > 0 ? '+' + diff.toFixed(4) : diff.toFixed(4)
    return `${diffStr} (${pct})`
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Run A: #{runA?.id} ({runA?.rows?.length} rows) vs Run B: #{runB?.id} ({runB?.rows?.length} rows)
        · Matched: {matched.length} · Only A: {onlyA.length} · Only B: {onlyB.length}
      </div>

      {matched.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>Matched Rows ({matched.length})</h4>
          <div className="results-table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="results-table">
              <thead>
                <tr>
                  <th>{keyField}</th>
                  {columns.filter(c => c !== keyField).map(c => (
                    <React.Fragment key={c}>
                      <th>A: {fieldMeta[c]?.label || c}</th>
                      <th>B: {fieldMeta[c]?.label || c}</th>
                      {numericCols.includes(c) && <th>Δ {fieldMeta[c]?.label || c}</th>}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matched.map(({ key, rowA, rowB, dupA, dupB }) => (
                  <tr key={key} style={dupA || dupB ? { background: 'rgba(255,152,0,0.1)' } : {}}>
                    <td>{key}{dupA && ' ⚠dup'}</td>
                    {columns.filter(c => c !== keyField).map(c => (
                      <React.Fragment key={c}>
                        <td>{rowA?.[c] ?? '—'}</td>
                        <td>{rowB?.[c] ?? '—'}</td>
                        {numericCols.includes(c) && <td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{calcDelta(c, rowA, rowB)}</td>}
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {onlyA.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-warning)' }}>Only in Run A ({onlyA.length})</h4>
          <div className="results-table-container" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="results-table">
              <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {onlyA.map(({ key, row }) => (
                  <tr key={key} style={{ background: 'rgba(255,152,0,0.08)' }}>
                    {columns.map(c => <td key={c}>{row[c] ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {onlyB.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-warning)' }}>Only in Run B ({onlyB.length})</h4>
          <div className="results-table-container" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="results-table">
              <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {onlyB.map(({ key, row }) => (
                  <tr key={key} style={{ background: 'rgba(255,152,0,0.08)' }}>
                    {columns.map(c => <td key={c}>{row[c] ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
