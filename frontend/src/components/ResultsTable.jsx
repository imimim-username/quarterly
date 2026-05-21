import React, { useState, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { buildAddressMap, resolveAddress } from '../utils/addressLabels.js'

const ROW_HEIGHT = 28
const VIRTUALIZE_THRESHOLD = 500
const DIVISOR_CYCLE = ['raw', '1e6', '1e18']

function isIntegerOnly(rows, field) {
  for (const row of rows) {
    const val = row[field]
    if (val === null || val === undefined || val === '') continue
    if (!/^-?\d+$/.test(String(val))) return false
  }
  return true
}

function applyDivisor(value, divisor) {
  try {
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    const negative = raw < 0n
    const abs = negative ? -raw : raw
    const intPart = abs / pow
    const fracRaw = (abs % pow).toString().padStart(Number(decimals), '0').replace(/0+$/, '')
    const result = fracRaw.length > 0 ? `${intPart}.${fracRaw}` : `${intPart}`
    return negative ? `-${result}` : result
  } catch {
    return String(value)
  }
}

function fmtNum(n) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toFixed(4).replace(/\.?0+$/, '')
}

/**
 * ResultsTable — sortable table with virtualisation for large datasets.
 * Column order: key field first, then insertion order.
 * Numeric fields scaled via fieldMeta or per-column divisor toggle (÷1e6 / ÷1e18).
 */
export default function ResultsTable({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {}, onDivisorChange, addressLabels = [] }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [copiedAddr, setCopiedAddr] = useState(null)
  const parentRef = useRef(null)

  // A) Full-text search
  const [searchText, setSearchText] = useState('')

  // B) Column visibility
  const [hiddenCols, setHiddenCols] = useState(new Set())
  const [colPanelOpen, setColPanelOpen] = useState(false)

  // D) Copy menu
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy ▾')

  const columns = useMemo(() => {
    if (!rows || rows.length === 0) return []
    const seen = new Set()
    const cols = []
    if (keyField && rows[0] && keyField in rows[0]) {
      cols.push(keyField)
      seen.add(keyField)
    }
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          cols.push(key)
          seen.add(key)
        }
      }
    }
    return cols
  }, [rows, keyField])

  // B) Visible columns filtered by hiddenCols
  const visibleColumns = useMemo(() => columns.filter(c => !hiddenCols.has(c)), [columns, hiddenCols])

  // Columns eligible for divisor toggle: integer-only, not timestamp
  const integerCols = useMemo(
    () => new Set(columns.filter(col => col !== 'timestamp' && isIntegerOnly(rows, col))),
    [columns, rows]
  )

  const cycleDivisor = (col, e) => {
    e.stopPropagation()
    const cur = colDivisors[col] || 'raw'
    const next = DIVISOR_CYCLE[(DIVISOR_CYCLE.indexOf(cur) + 1) % DIVISOR_CYCLE.length]
    onDivisorChange?.({ ...colDivisors, [col]: next })
  }

  const addressMap = useMemo(() => buildAddressMap(addressLabels), [addressLabels])

  const sortedRows = useMemo(() => {
    if (!rows) return []
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const aNum = parseFloat(av)
      const bNum = parseFloat(bv)
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum
      }
      const as = String(av)
      const bs = String(bv)
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [rows, sortCol, sortDir])

  // A) Apply full-text search filter after sort
  const displayRows = useMemo(() => {
    if (!searchText) return sortedRows
    const lower = searchText.toLowerCase()
    return sortedRows.filter(row =>
      columns.some(col => {
        const v = row[col]
        return v != null && String(v).toLowerCase().includes(lower)
      })
    )
  }, [sortedRows, searchText, columns])

  // C) Stats bar: numeric columns (non-timestamp) with at least one parseable value
  const statCols = useMemo(() => {
    if (displayRows.length === 0) return []
    return visibleColumns
      .filter(col => {
        const meta = fieldMeta[col]
        if (meta && (meta.type === 'unix_seconds' || meta.type === 'unix_ms')) return false
        if (col === 'timestamp') return false
        return true
      })
      .map(col => {
        const nums = displayRows
          .map(r => r[col])
          .filter(v => v != null && v !== '' && !isNaN(Number(v)))
          .map(Number)
        if (nums.length === 0) return null
        const sum = nums.reduce((a, b) => a + b, 0)
        const mean = sum / nums.length
        const min = Math.min(...nums)
        const max = Math.max(...nums)
        return { col, sum, mean, min, max }
      })
      .filter(Boolean)
  }, [displayRows, visibleColumns, fieldMeta])

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const handleAddressCopy = (rawAddr) => {
    navigator.clipboard.writeText(rawAddr).then(() => {
      setCopiedAddr(rawAddr)
      setTimeout(() => setCopiedAddr(null), 1800)
    })
  }

  const formatCell = (col, value, row) => {
    if (value === null || value === undefined) return ''

    // Address book lookup
    const label = resolveAddress(String(value), row?.chain || '', addressMap)
    if (label !== null) return label

    // Per-column toggle takes priority over fieldMeta
    const divisor = colDivisors[col]
    if (divisor === 'datetime') {
      const n = Number(value)
      return isNaN(n) ? String(value) : new Date(n * 1000).toLocaleString()
    }
    if (divisor && divisor !== 'raw') {
      return applyDivisor(value, divisor)
    }

    const meta = fieldMeta[col]
    if (meta) {
      if (meta.type === 'unix_seconds') {
        const n = Number(value)
        if (!isNaN(n)) return new Date(n * 1000).toLocaleString()
      }
      if (meta.type === 'unix_ms') {
        const n = Number(value)
        if (!isNaN(n)) return new Date(n).toLocaleString()
      }
      if (meta.decimals !== undefined) {
        try {
          const raw = BigInt(value)
          const d = BigInt(meta.decimals)
          const divisor = 10n ** d
          const negative = raw < 0n
          const abs = negative ? -raw : raw
          const intPart = abs / divisor
          const fracRaw = (abs % divisor).toString().padStart(meta.decimals, '0').replace(/0+$/, '')
          const magnitude = fracRaw.length > 0 ? `${intPart}.${fracRaw}` : `${intPart}`
          const label = negative ? `-${magnitude}` : magnitude
          return meta.unit ? `${label} ${meta.unit}` : label
        } catch (e) {
          return String(value)
        }
      }
    }
    return String(value)
  }

  // Returns props for a <td> — adds click-to-copy and pointer cursor when a label resolves
  const cellProps = (col, row) => {
    const raw = String(row[col] ?? '')
    const label = resolveAddress(raw, row?.chain || '', addressMap)
    if (!label) return { title: raw }
    return {
      title: raw,
      style: { cursor: 'pointer' },
      onClick: () => handleAddressCopy(raw),
    }
  }

  // D) Copy handlers
  const handleCopy = (format) => {
    const headers = visibleColumns
    const rowsData = displayRows.map(r => headers.map(h => String(r[h] ?? '')))
    let text = ''
    if (format === 'Markdown') {
      const sep = headers.map(() => '----').join(' | ')
      text = `| ${headers.join(' | ')} |\n| ${sep} |\n`
      text += rowsData.map(row => `| ${row.join(' | ')} |`).join('\n')
    } else if (format === 'HTML') {
      text = '<table>\n<thead>\n<tr>'
      text += headers.map(h => `<th>${h}</th>`).join('')
      text += '</tr>\n</thead>\n<tbody>\n'
      text += rowsData.map(row => `<tr>${row.map(v => `<td>${v}</td>`).join('')}</tr>`).join('\n')
      text += '\n</tbody>\n</table>'
    } else if (format === 'TSV') {
      text = [headers.join('\t'), ...rowsData.map(row => row.join('\t'))].join('\n')
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopyLabel('Copied!')
      setCopyMenuOpen(false)
      setTimeout(() => setCopyLabel('Copy ▾'), 1500)
    })
  }

  const useVirtual = displayRows.length > VIRTUALIZE_THRESHOLD

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    enabled: useVirtual,
  })

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* A) Search bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 4 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            placeholder="Search rows…"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ fontSize: 12, padding: '3px 8px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        {searchText && (
          <button onClick={() => setSearchText('')} style={{ fontSize: 12, padding: '1px 6px', flexShrink: 0 }}>×</button>
        )}
        {searchText && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {displayRows.length} of {sortedRows.length} rows
          </span>
        )}
        {/* B) Column visibility button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => { setColPanelOpen(v => !v); setCopyMenuOpen(false) }}
            title="Column visibility"
            style={{ fontSize: 13, padding: '1px 6px' }}
          >
            ⚙
          </button>
          {colPanelOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              maxHeight: 250,
              overflowY: 'auto',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              zIndex: 10,
              minWidth: 180,
              padding: '4px 0',
            }}>
              <div style={{ padding: '2px 8px' }}>
                <button
                  onClick={() => setHiddenCols(new Set())}
                  style={{ fontSize: 11, padding: '1px 6px', width: '100%' }}
                >
                  Show all
                </button>
              </div>
              <hr style={{ margin: '4px 0', borderColor: 'var(--color-border)' }} />
              {columns.map(col => (
                <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col)}
                    onChange={() => {
                      setHiddenCols(prev => {
                        const next = new Set(prev)
                        if (next.has(col)) next.delete(col)
                        else next.add(col)
                        return next
                      })
                    }}
                  />
                  {col}
                </label>
              ))}
            </div>
          )}
        </div>
        {/* D) Copy menu button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => { setCopyMenuOpen(v => !v); setColPanelOpen(false) }}
            style={{ fontSize: 12, padding: '1px 6px' }}
          >
            {copyLabel}
          </button>
          {copyMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              zIndex: 10,
              minWidth: 120,
              padding: '4px 0',
            }}>
              {['Markdown', 'HTML', 'TSV'].map(fmt => (
                <div
                  key={fmt}
                  onClick={() => handleCopy(fmt)}
                  style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  {fmt}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table container */}
      <div
        ref={parentRef}
        className="results-table-container"
        style={{ maxHeight: 500, overflowY: 'auto' }}
      >
        <table className="results-table">
          <thead>
            <tr>
              {visibleColumns.map(col => {
                const divisor = colDivisors[col] || 'raw'
                return (
                  <th key={col} onClick={() => handleSort(col)}>
                    {fieldMeta[col]?.label || col}
                    {sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    {col === 'timestamp' && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          const cur = colDivisors['timestamp'] || 'raw'
                          onDivisorChange?.({ ...colDivisors, timestamp: cur === 'datetime' ? 'raw' : 'datetime' })
                        }}
                        title="Toggle datetime formatting"
                        style={{
                          marginLeft: 5,
                          fontSize: 10,
                          padding: '1px 5px',
                          background: divisor === 'datetime' ? 'var(--color-accent)' : 'var(--color-surface2)',
                          border: '1px solid ' + (divisor === 'datetime' ? 'var(--color-accent)' : 'var(--color-border)'),
                          color: divisor === 'datetime' ? '#fff' : 'var(--color-text-muted)',
                          borderRadius: 3,
                          cursor: 'pointer',
                          lineHeight: 1.4,
                          verticalAlign: 'middle',
                        }}
                      >
                        {divisor === 'datetime' ? 'datetime' : 'raw'}
                      </button>
                    )}
                    {integerCols.has(col) && (
                      <button
                        onClick={e => cycleDivisor(col, e)}
                        title="Cycle display divisor: raw → ÷1e6 → ÷1e18"
                        style={{
                          marginLeft: 5,
                          fontSize: 10,
                          padding: '1px 5px',
                          background: divisor === 'raw' ? 'var(--color-surface2)' : 'var(--color-accent)',
                          border: '1px solid ' + (divisor === 'raw' ? 'var(--color-border)' : 'var(--color-accent)'),
                          color: divisor === 'raw' ? 'var(--color-text-muted)' : '#fff',
                          borderRadius: 3,
                          cursor: 'pointer',
                          lineHeight: 1.4,
                          verticalAlign: 'middle',
                        }}
                      >
                        {divisor === 'raw' ? 'raw' : divisor === '1e6' ? '÷1e6' : '÷1e18'}
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {useVirtual ? (
              <>
                <tr style={{ height: rowVirtualizer.getVirtualItems()[0]?.start || 0 }}>
                  <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                </tr>
                {rowVirtualizer.getVirtualItems().map(vi => {
                  const row = displayRows[vi.index]
                  return (
                    <tr key={vi.index} style={{ height: ROW_HEIGHT }}>
                      {visibleColumns.map(col => (
                        <td key={col} {...cellProps(col, row)}>{formatCell(col, row[col], row)}</td>
                      ))}
                    </tr>
                  )
                })}
                <tr style={{ height: rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().slice(-1)[0]?.end || 0) }}>
                  <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                </tr>
              </>
            ) : (
              displayRows.map((row, i) => (
                <tr key={i}>
                  {visibleColumns.map(col => (
                    <td key={col} {...cellProps(col, row)}>{formatCell(col, row[col], row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* C) Stats bar */}
      {statCols.length > 0 && displayRows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '6px 0', fontSize: 11 }}>
          {statCols.map(({ col, sum, mean, min, max }) => (
            <div key={col} style={{ flexShrink: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>
              <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>{col}</div>
              <div>Σ {fmtNum(sum)} · avg {fmtNum(mean)} · min {fmtNum(min)} · max {fmtNum(max)}</div>
            </div>
          ))}
        </div>
      )}

      {copiedAddr && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '8px 14px',
          fontSize: 12,
          color: 'var(--color-text)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }}>
          Copied <span style={{ fontFamily: 'monospace' }}>{copiedAddr.slice(0, 10)}…{copiedAddr.slice(-6)}</span>
        </div>
      )}
    </div>
  )
}
