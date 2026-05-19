import { useMemo } from 'react'

/**
 * ResultFilters — auto-detects filterable columns from result rows and renders
 * one chip row per column. Columns whose every non-null value is a plain integer
 * are excluded (e.g. timestamp, shares, assets). Multiple column filters are ANDed.
 */

const MAX_CHIPS = 50

function isIntegerOnly(rows, field) {
  for (const row of rows) {
    const val = row[field]
    if (val === null || val === undefined || val === '') continue
    if (!/^-?\d+$/.test(String(val))) return false
  }
  return true
}

export default function ResultFilters({ rows, activeFilters, onChange }) {
  const filterableFields = useMemo(() => {
    if (!rows || rows.length === 0) return []
    const cols = Object.keys(rows[0])
    return cols
      .filter(col => !isIntegerOnly(rows, col))
      .map(col => {
        const vals = [
          ...new Set(
            rows.map(r => r[col]).filter(v => v != null && v !== '').map(String)
          ),
        ].sort()
        return { col, vals }
      })
      .filter(({ vals }) => vals.length >= 2 && vals.length <= MAX_CHIPS)
  }, [rows])

  if (filterableFields.length === 0) return null

  const chipLabel = str => str.length > 20 ? str.slice(0, 8) + '…' + str.slice(-6) : str

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      {filterableFields.map(({ col, vals }) => {
        const active = activeFilters[col] || []
        const allActive = active.length === 0

        const toggle = val => {
          const next = allActive
            ? [val]
            : active.includes(val)
              ? active.filter(v => v !== val)
              : [...active, val]
          onChange({ ...activeFilters, [col]: next.length === vals.length ? [] : next })
        }

        return (
          <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              minWidth: 56,
              textAlign: 'right',
              flexShrink: 0,
            }}>
              {col}
            </span>
            <button
              onClick={() => onChange({ ...activeFilters, [col]: [] })}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                background: allActive ? 'var(--color-accent)' : 'var(--color-surface2)',
                border: '1px solid ' + (allActive ? 'var(--color-accent)' : 'var(--color-border)'),
              }}
            >
              All
            </button>
            {vals.map(val => {
              const isActive = !allActive && active.includes(val)
              return (
                <button
                  key={val}
                  onClick={() => toggle(val)}
                  title={val.length > 20 ? val : undefined}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    background: isActive ? 'var(--color-accent)' : 'var(--color-surface2)',
                    border: '1px solid ' + (isActive ? 'var(--color-accent)' : 'var(--color-border)'),
                  }}
                >
                  {chipLabel(val)}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
