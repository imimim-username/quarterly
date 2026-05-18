import React, { useMemo } from 'react'

/**
 * ChainFilter — chip bar for filtering by chain.
 * Auto-infers unique chains from rows[chainField].
 */
export default function ChainFilter({ rows, chainField = 'chain', activeChains, onChange }) {
  const chains = useMemo(() => {
    if (!rows || rows.length === 0) return []
    const set = new Set()
    for (const row of rows) {
      const val = row[chainField]
      if (val !== null && val !== undefined && val !== '') {
        set.add(String(val))
      }
    }
    return [...set].sort()
  }, [rows, chainField])

  if (chains.length === 0) return null

  const toggle = (chain) => {
    if (!activeChains || activeChains.length === 0) {
      // All active → select only this one
      onChange([chain])
    } else if (activeChains.includes(chain)) {
      const next = activeChains.filter(c => c !== chain)
      onChange(next.length === 0 ? [] : next) // empty = all
    } else {
      onChange([...activeChains, chain])
    }
  }

  const allActive = !activeChains || activeChains.length === 0

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      <button
        onClick={() => onChange([])}
        style={{
          padding: '3px 10px',
          fontSize: 12,
          background: allActive ? 'var(--color-accent)' : 'var(--color-surface2)',
          border: '1px solid ' + (allActive ? 'var(--color-accent)' : 'var(--color-border)'),
        }}
      >
        All
      </button>
      {chains.map(chain => {
        const active = allActive || activeChains.includes(chain)
        return (
          <button
            key={chain}
            onClick={() => toggle(chain)}
            style={{
              padding: '3px 10px',
              fontSize: 12,
              background: active && !allActive ? 'var(--color-accent)' : 'var(--color-surface2)',
              border: '1px solid ' + (active && !allActive ? 'var(--color-accent)' : 'var(--color-border)'),
            }}
          >
            {chain}
          </button>
        )
      })}
    </div>
  )
}
