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

/**
 * ResultsTable — sortable table with virtualisation for large datasets.
 * Column order: key field first, then insertion order.
 * Numeric fields scaled via fieldMeta or per-column divisor toggle (÷1e6 / ÷1e18).
 */
export default function ResultsTable({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {}, onDivisorChange, addressLabels = [] }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const parentRef = useRef(null)

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

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
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

  const useVirtual = sortedRows.length > VIRTUALIZE_THRESHOLD

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    enabled: useVirtual,
  })

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results.</div>
  }

  return (
    <div
      ref={parentRef}
      className="results-table-container"
      style={{ maxHeight: 500, overflowY: 'auto' }}
    >
      <table className="results-table">
        <thead>
          <tr>
            {columns.map(col => {
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
                <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
              </tr>
              {rowVirtualizer.getVirtualItems().map(vi => {
                const row = sortedRows[vi.index]
                return (
                  <tr key={vi.index} style={{ height: ROW_HEIGHT }}>
                    {columns.map(col => (
                      <td key={col} title={String(row[col] ?? '')} style={resolveAddress(String(row[col] ?? ''), row?.chain || '', addressMap) ? { cursor: 'help' } : undefined}>{formatCell(col, row[col], row)}</td>
                    ))}
                  </tr>
                )
              })}
              <tr style={{ height: rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().slice(-1)[0]?.end || 0) }}>
                <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
              </tr>
            </>
          ) : (
            sortedRows.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col} title={String(row[col] ?? '')}>{formatCell(col, row[col], row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
