import React, { useState, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const ROW_HEIGHT = 28
const VIRTUALIZE_THRESHOLD = 500

/**
 * ResultsTable — sortable table with virtualisation for large datasets.
 * Column order: key field first, then insertion order.
 * Numeric fields scaled via fieldMeta.
 */
export default function ResultsTable({ rows, fieldMeta = {}, keyField = 'id' }) {
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

  const formatCell = (col, value) => {
    if (value === null || value === undefined) return ''
    const meta = fieldMeta[col]
    if (meta) {
      if (meta.type === 'unix_seconds') {
        const n = Number(value)
        if (!isNaN(n)) return new Date(n * 1000).toLocaleString()
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
            {columns.map(col => (
              <th key={col} onClick={() => handleSort(col)}>
                {fieldMeta[col]?.label || col}
                {sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
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
                      <td key={col} title={String(row[col] ?? '')}>{formatCell(col, row[col])}</td>
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
                  <td key={col} title={String(row[col] ?? '')}>{formatCell(col, row[col])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
