import React, { useState, useEffect } from 'react'
import { getReportRun, getReport, getRun } from '../api/client.js'

function StatusCell({ status, run }) {
  if (!status || status === 'missing') {
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  }
  if (status === 'pending') {
    return <span style={{ color: 'var(--color-text-muted)' }}>⏳ pending</span>
  }
  if (status === 'failed') {
    return <span style={{ color: 'var(--color-error)' }}>✗ failed</span>
  }
  if (status === 'ok' && run) {
    return (
      <span style={{ color: 'var(--color-success)' }}>
        ✓ {run.row_count ?? '?'} rows
        {run.duration_ms != null && (
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
            {' '}({run.duration_ms}ms)
          </span>
        )}
      </span>
    )
  }
  return <span style={{ color: 'var(--color-text-muted)' }}>{status}</span>
}

function DeltaCell({ runA, runB, statusA, statusB }) {
  if (statusA !== 'ok' || statusB !== 'ok') {
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  }
  if (!runA || !runB) {
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  }
  const countA = runA.row_count ?? 0
  const countB = runB.row_count ?? 0
  const delta = countB - countA
  if (delta === 0) {
    return <span style={{ color: 'var(--color-text-muted)' }}>0</span>
  }
  const pct = countA === 0 ? null : ((delta / countA) * 100).toFixed(1)
  const color = delta > 0 ? 'var(--color-success)' : 'var(--color-error)'
  const sign = delta > 0 ? '+' : ''
  return (
    <span style={{ color, fontWeight: 600 }}>
      {sign}{delta}
      {pct !== null && (
        <span style={{ fontWeight: 400 }}> ({sign}{pct}%)</span>
      )}
    </span>
  )
}

function formatDate(str) {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleString()
  } catch {
    return str
  }
}

export default function ReportCompareView({ runAId, runBId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runA, setRunA] = useState(null)
  const [runB, setRunB] = useState(null)
  // Map from query_id -> { name }
  const [queryMeta, setQueryMeta] = useState({})
  // Map from run_id -> run detail object
  const [runDetails, setRunDetails] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [resA, resB] = await Promise.all([
          getReportRun(runAId),
          getReportRun(runBId),
        ])
        if (!resA.ok) throw new Error(`Run A not found: ${resA.data?.message || resA.status}`)
        if (!resB.ok) throw new Error(`Run B not found: ${resB.data?.message || resB.status}`)
        if (cancelled) return

        const a = resA.data
        const b = resB.data
        setRunA(a)
        setRunB(b)

        // Load query names from the report (use run A's report_id, fall back to run B)
        const reportId = a.report_id ?? b.report_id
        let qmeta = {}
        if (reportId) {
          const rRes = await getReport(reportId)
          if (!cancelled && rRes.ok && Array.isArray(rRes.data?.queries)) {
            for (const q of rRes.data.queries) {
              qmeta[q.id] = { name: q.name }
            }
          }
        }
        if (!cancelled) setQueryMeta(qmeta)

        // Collect all run_ids that are non-null and ok
        const runIds = new Set()
        for (const q of [...(a.queries || []), ...(b.queries || [])]) {
          if (q.run_id != null && q.status === 'ok') runIds.add(q.run_id)
        }

        // Fetch run details in parallel
        const details = {}
        await Promise.all([...runIds].map(async (rid) => {
          const res = await getRun(rid)
          if (!cancelled && res.ok && res.data) {
            details[rid] = res.data
          }
        }))
        if (!cancelled) setRunDetails(details)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load runs.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [runAId, runBId])

  // Build merged query list for the table
  const mergedQueries = React.useMemo(() => {
    if (!runA || !runB) return []
    const allIds = new Set([
      ...(runA.queries || []).map(q => q.query_id),
      ...(runB.queries || []).map(q => q.query_id),
    ])
    const mapA = Object.fromEntries((runA.queries || []).map(q => [q.query_id, q]))
    const mapB = Object.fromEntries((runB.queries || []).map(q => [q.query_id, q]))
    return [...allIds].map(qid => {
      const qa = mapA[qid]
      const qb = mapB[qid]
      return {
        query_id: qid,
        name: queryMeta[qid]?.name || `Query ${qid}`,
        statusA: qa?.status ?? 'missing',
        statusB: qb?.status ?? 'missing',
        run_id_a: qa?.run_id ?? null,
        run_id_b: qb?.run_id ?? null,
        errorA: qa?.error_message,
        errorB: qb?.error_message,
      }
    })
  }, [runA, runB, queryMeta])

  // Summary stats
  const summary = React.useMemo(() => {
    if (!mergedQueries.length) return null
    let bothOk = 0, aOnly = 0, bOnly = 0, failed = 0, pending = 0
    for (const q of mergedQueries) {
      const okA = q.statusA === 'ok'
      const okB = q.statusB === 'ok'
      if (okA && okB) bothOk++
      else if (okA && !okB) aOnly++
      else if (!okA && okB) bOnly++
      if (q.statusA === 'failed' || q.statusB === 'failed') failed++
      if (q.statusA === 'pending' || q.statusB === 'pending') pending++
    }
    return { total: mergedQueries.length, bothOk, aOnly, bOnly, failed, pending }
  }, [mergedQueries])

  const thStyle = {
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    whiteSpace: 'nowrap',
  }
  const tdStyle = {
    padding: '6px 10px',
    fontSize: 12,
    color: 'var(--color-text)',
    borderBottom: '1px solid var(--color-border)',
    verticalAlign: 'middle',
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>Report Comparison</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ fontSize: 12, padding: '3px 10px' }}>✕ Close</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: 20 }}>
            Loading runs…
          </div>
        )}

        {error && (
          <div className="error-banner" style={{ padding: '6px 10px', fontSize: 13, margin: '12px 0' }}>
            {error}
          </div>
        )}

        {!loading && !error && runA && runB && (
          <>
            {/* Metadata row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 14,
            }}>
              {[{ label: 'A', run: runA }, { label: 'B', run: runB }].map(({ label, run }) => (
                <div
                  key={label}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                    Run {label} #{run.id}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Period: </span>
                    {run.start_date || '?'} → {run.end_date || '?'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text)', marginTop: 2 }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Ran: </span>
                    {formatDate(run.ran_at)}
                  </div>
                  {run.endpoint && (
                    <div style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-mono)',
                      marginTop: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {run.endpoint}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Summary row */}
            {summary && (
              <div style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                marginBottom: 14,
                padding: '8px 14px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                fontSize: 12,
              }}>
                <span><strong>{summary.total}</strong> <span style={{ color: 'var(--color-text-muted)' }}>total queries</span></span>
                <span style={{ color: 'var(--color-success)' }}>
                  <strong>{summary.bothOk}</strong> <span style={{ color: 'var(--color-text-muted)' }}>both ok</span>
                </span>
                {summary.aOnly > 0 && (
                  <span style={{ color: 'var(--color-warning)' }}>
                    <strong>{summary.aOnly}</strong> <span style={{ color: 'var(--color-text-muted)' }}>A only ok</span>
                  </span>
                )}
                {summary.bOnly > 0 && (
                  <span style={{ color: 'var(--color-warning)' }}>
                    <strong>{summary.bOnly}</strong> <span style={{ color: 'var(--color-text-muted)' }}>B only ok</span>
                  </span>
                )}
                {summary.failed > 0 && (
                  <span style={{ color: 'var(--color-error)' }}>
                    <strong>{summary.failed}</strong> <span style={{ color: 'var(--color-text-muted)' }}>with failures</span>
                  </span>
                )}
                {summary.pending > 0 && (
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    <strong>{summary.pending}</strong> pending
                  </span>
                )}
              </div>
            )}

            {/* Per-query comparison table */}
            <div className="results-table-container" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Query</th>
                    <th style={thStyle}>Run A</th>
                    <th style={thStyle}>Run B</th>
                    <th style={thStyle}>Δ Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedQueries.map(q => {
                    const runDetailA = q.run_id_a != null ? runDetails[q.run_id_a] : null
                    const runDetailB = q.run_id_b != null ? runDetails[q.run_id_b] : null
                    return (
                      <tr key={q.query_id}>
                        <td style={{ ...tdStyle, fontWeight: 500 }}>
                          {q.name}
                        </td>
                        <td style={tdStyle}>
                          <StatusCell status={q.statusA} run={runDetailA} />
                          {q.statusA === 'failed' && q.errorA && (
                            <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 2 }}>
                              {q.errorA}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <StatusCell status={q.statusB} run={runDetailB} />
                          {q.statusB === 'failed' && q.errorB && (
                            <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 2 }}>
                              {q.errorB}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <DeltaCell
                            runA={runDetailA}
                            runB={runDetailB}
                            statusA={q.statusA}
                            statusB={q.statusB}
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {mergedQueries.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ ...tdStyle, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                        No queries in these runs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
