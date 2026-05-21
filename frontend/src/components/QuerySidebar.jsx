import React, { useEffect, useState, useCallback } from 'react'
import { listQueries, importQueries, getSettings, updateSettings } from '../api/client.js'

const BUILTIN_PATH = '/queries/builtin'

async function loadAndImportBuiltins() {
  const names = ['myt_deposits', 'alchemist_deposits', 'user_counts']
  const builtins = []
  for (const name of names) {
    try {
      const res = await fetch(`${BUILTIN_PATH}/${name}.json`)
      if (res.ok) {
        builtins.push(await res.json())
      }
    } catch (e) {
      console.warn('Could not load builtin:', name, e)
    }
  }
  if (builtins.length > 0) {
    await importQueries(builtins)
  }
  await updateSettings({ builtin_imported: '1' })
}

/**
 * QuerySidebar — tree grouped by category.
 * Each item shows name, last-run timestamp, last row count.
 */
export default function QuerySidebar({
  selectedQueryId,
  onSelectQuery,
  onNewQuery,
  onRefresh,
  refreshTrigger,
  onCloneQuery = () => {},
}) {
  const [queries, setQueries] = useState([])
  const [loading, setLoading] = useState(true)
  // A) Search/filter state
  const [search, setSearch] = useState('')
  // B) Clone hover state
  const [hoveredId, setHoveredId] = useState(null)

  const fetchQueries = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await listQueries()
      setQueries(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Failed to load queries:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Import built-ins on first launch
  useEffect(() => {
    async function checkAndImport() {
      try {
        const { data: settings } = await getSettings()
        if (settings && settings.builtin_imported !== '1') {
          await loadAndImportBuiltins()
        }
      } catch (e) {
        console.error('Failed to check builtin_imported:', e)
      }
      await fetchQueries()
    }
    checkAndImport()
  }, [fetchQueries])

  // Refresh when parent signals
  useEffect(() => {
    if (refreshTrigger > 0) fetchQueries()
  }, [refreshTrigger, fetchQueries])

  // A) Filter before grouping
  const filtered = search
    ? queries.filter(q => q.name.toLowerCase().includes(search.toLowerCase()))
    : queries

  // Group filtered queries by category
  const grouped = {}
  for (const q of filtered) {
    const cat = q.category || 'General'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(q)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="sidebar-actions">
        <button onClick={onNewQuery} style={{ flex: 1 }}>+ New Query</button>
        <button onClick={fetchQueries} title="Refresh query list" style={{ padding: '4px 8px' }}>↻</button>
      </div>

      {/* A) Search input */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>
        <input
          placeholder="Filter queries…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', fontSize: 12, padding: '3px 6px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading && (
          <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>
            {search ? 'No matching queries.' : 'No queries yet.'}
          </div>
        )}
        {Object.entries(grouped).map(([category, qs]) => (
          <div key={category}>
            <div className="sidebar-category">{category}</div>
            {qs.map(q => (
              <div
                key={q.id}
                className={`sidebar-item ${selectedQueryId === q.id ? 'active' : ''}`}
                onClick={() => onSelectQuery(q)}
                onMouseEnter={() => setHoveredId(q.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Name row: text + clone button side-by-side */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="sidebar-item-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {q.is_builtin ? '🔒 ' : ''}{q.name}
                  </span>
                  {/* B) Clone button — invisible when not hovered to preserve layout */}
                  <button
                    title="Duplicate query"
                    onClick={e => { e.stopPropagation(); onCloneQuery(q) }}
                    style={{
                      fontSize: 11, padding: '1px 5px', flexShrink: 0,
                      visibility: hoveredId === q.id ? 'visible' : 'hidden',
                      opacity: 0.7,
                    }}
                  >
                    ⧉
                  </button>
                </div>
                <div className="sidebar-item-meta">
                  {q.last_run_at
                    ? `Last run: ${new Date(q.last_run_at).toLocaleDateString()}`
                    : 'Never run'}
                  {q.last_row_count != null ? ` · ${q.last_row_count} rows` : ''}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
