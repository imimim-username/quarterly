import React, { useState, useEffect, useCallback } from 'react'
import { listRuns, getRun, deleteRun } from '../api/client.js'

/**
 * HistoryDrawer — slide-in panel listing past runs for the current query.
 * Click loads the run into the Results tab without re-fetch.
 */
export default function HistoryDrawer({ queryId, open, onClose, onLoadRun, onCompare }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(false)
  const [pinned, setPinned] = useState(null) // run pinned for compare

  const fetchRuns = useCallback(async () => {
    if (!queryId) return
    setLoading(true)
    try {
      const { data } = await listRuns(queryId, 50, 0)
      setRuns(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Failed to load runs:', e)
    } finally {
      setLoading(false)
    }
  }, [queryId])

  useEffect(() => {
    if (open && queryId) fetchRuns()
  }, [open, queryId, fetchRuns])

  const handleLoadRun = async (runId) => {
    const { data } = await getRun(runId)
    if (data && !data.error) {
      onLoadRun && onLoadRun(data)
    }
  }

  const handleDeleteRun = async (runId) => {
    if (!window.confirm('Delete this run from history?')) return
    await deleteRun(runId)
    fetchRuns()
  }

  const handleCompare = async (runId) => {
    if (!pinned) {
      const { data } = await getRun(runId)
      setPinned(data)
    } else {
      const { data } = await getRun(runId)
      onCompare && onCompare(pinned, data)
      setPinned(null)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: 380,
      background: 'var(--color-surface)',
      borderLeft: '1px solid var(--color-border)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Run History</span>
        <button onClick={onClose} style={{ padding: '4px 8px', fontSize: 14 }}>✕</button>
      </div>

      {pinned && (
        <div style={{ padding: '8px 16px', background: 'rgba(233,69,96,0.1)', fontSize: 12, borderBottom: '1px solid var(--color-border)' }}>
          Pinned run #{pinned.id} — click another run to compare.
          <button onClick={() => setPinned(null)} style={{ marginLeft: 8, padding: '1px 6px', fontSize: 11 }}>Clear</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!loading && runs.length === 0 && (
          <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>No runs yet.</div>
        )}
        {runs.map(run => (
          <div key={run.id} style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Run #{run.id}
                {run.error_type && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-error)' }}>
                    [{run.error_type}]
                  </span>
                )}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {new Date(run.ran_at).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {run.row_count} rows · {run.page_count} pages · {run.duration_ms}ms
            </div>
            {run.start_date && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {run.start_date} → {run.end_date}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button onClick={() => handleLoadRun(run.id)} style={{ fontSize: 11, padding: '2px 8px' }}>
                Load
              </button>
              <button
                onClick={() => handleCompare(run.id)}
                style={{ fontSize: 11, padding: '2px 8px', background: pinned?.id === run.id ? 'var(--color-accent)' : undefined }}
              >
                {pinned ? (pinned.id === run.id ? 'Pinned' : 'Compare') : 'Pin'}
              </button>
              <button onClick={() => handleDeleteRun(run.id)} style={{ fontSize: 11, padding: '2px 8px', color: 'var(--color-error)', background: 'transparent' }}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
