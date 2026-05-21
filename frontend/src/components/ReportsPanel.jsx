import React, { useState, useEffect } from 'react'
import ReportBuilder from './ReportBuilder.jsx'
import ReportCompareView from './ReportCompareView.jsx'
import { listReports, getReport, listReportRuns } from '../api/client.js'

export default function ReportsPanel({ startDate, endDate }) {
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null) // null = none, {} = new, {...} = existing
  const [reportRuns, setReportRuns] = useState([])
  const [pinnedRun, setPinnedRun] = useState(null)
  const [compareIds, setCompareIds] = useState(null) // { runAId, runBId }
  const [refresh, setRefresh] = useState(0)
  const [loadingRuns, setLoadingRuns] = useState(false)

  // Fetch reports list
  useEffect(() => {
    listReports().then(({ data }) => setReports(Array.isArray(data) ? data : []))
  }, [refresh])

  // Fetch full report detail + run history when selected
  useEffect(() => {
    if (!selectedReport?.id) { setReportRuns([]); return }
    getReport(selectedReport.id).then(({ data }) => { if (data && !data.error) setSelectedReport(data) })
    setLoadingRuns(true)
    listReportRuns(selectedReport.id)
      .then(({ data }) => setReportRuns(Array.isArray(data) ? data : []))
      .finally(() => setLoadingRuns(false))
  }, [selectedReport?.id, refresh])

  const handleSave = (report) => {
    setSelectedReport(report)
    setRefresh(r => r + 1)
  }

  const handleDelete = () => {
    setSelectedReport(null)
    setRefresh(r => r + 1)
  }

  const handleRunComplete = () => {
    setRefresh(r => r + 1)
  }

  const handlePin = (run) => {
    if (!pinnedRun) {
      setPinnedRun(run)
    } else if (pinnedRun.id === run.id) {
      setPinnedRun(null)
    } else {
      setCompareIds({ runAId: pinnedRun.id, runBId: run.id })
      setPinnedRun(null)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left column: report list */}
      <div style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
          <button
            onClick={() => { setSelectedReport({}); setReportRuns([]); setPinnedRun(null) }}
            style={{ width: '100%', fontSize: 12, padding: '4px 0' }}
          >
            + New Report
          </button>
        </div>
        {reports.length === 0 && (
          <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: 12 }}>
            No reports yet.
          </div>
        )}
        {reports.map(r => (
          <div
            key={r.id}
            onClick={() => { setSelectedReport(r); setPinnedRun(null) }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--color-border)',
              background: selectedReport?.id === r.id ? 'var(--color-surface2)' : undefined,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 500 }}>{r.name}</div>
            {r.description && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{r.description}</div>
            )}
          </div>
        ))}
      </div>

      {/* Right column: detail */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {selectedReport === null ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            Select a report from the list, or create a new one.
          </div>
        ) : (
          <>
            <ReportBuilder
              report={selectedReport?.id ? selectedReport : null}
              startDate={startDate}
              endDate={endDate}
              onSave={handleSave}
              onDelete={handleDelete}
              onRunComplete={handleRunComplete}
            />

            {selectedReport?.id && (
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}>
                  Run History
                  {pinnedRun && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-warning)', textTransform: 'none' }}>
                      Run #{pinnedRun.id} pinned — click another run to compare
                      <button
                        onClick={() => setPinnedRun(null)}
                        style={{ marginLeft: 6, fontSize: 10, padding: '0 5px', background: 'transparent' }}
                      >
                        Clear
                      </button>
                    </span>
                  )}
                </div>

                {loadingRuns && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
                )}

                {!loadingRuns && reportRuns.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    No runs yet. Click ▶ Run All to execute all queries.
                  </div>
                )}

                {reportRuns.map(rr => (
                  <div
                    key={rr.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 0',
                      borderBottom: '1px solid var(--color-border)',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>Run #{rr.id}</span>
                      <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                        {new Date(rr.ran_at).toLocaleString()}
                      </span>
                      {rr.start_date && (
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 11 }}>
                          {rr.start_date.slice(0, 10)} → {rr.end_date?.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handlePin(rr)}
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        background: pinnedRun?.id === rr.id ? 'var(--color-accent)' : 'transparent',
                        color: pinnedRun?.id === rr.id ? '#fff' : undefined,
                        border: `1px solid ${pinnedRun?.id === rr.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        borderRadius: 3,
                      }}
                    >
                      {pinnedRun?.id === rr.id ? 'Pinned' : pinnedRun ? 'Compare' : 'Pin'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Report compare overlay */}
      {compareIds && (
        <ReportCompareView
          runAId={compareIds.runAId}
          runBId={compareIds.runBId}
          onClose={() => setCompareIds(null)}
        />
      )}
    </div>
  )
}
