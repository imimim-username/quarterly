import React, { useState, useEffect } from 'react'
import ReportBuilder from './ReportBuilder.jsx'
import { listReports, getReport } from '../api/client.js'

export default function ReportsPanel({ startDate, endDate, addressLabels = [] }) {
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null) // null = none, {} = new, {...} = existing
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)

  // Fetch reports list
  useEffect(() => {
    listReports().then(({ data }) => setReports(Array.isArray(data) ? data : []))
  }, [refresh])

  // Fetch full report detail (with instances) when selection changes
  useEffect(() => {
    if (!selectedReport?.id) return
    setLoading(true)
    getReport(selectedReport.id)
      .then(({ data }) => { if (data && !data.error) setSelectedReport(data) })
      .finally(() => setLoading(false))
  }, [selectedReport?.id, refresh])

  const handleSave = (report) => {
    setSelectedReport(prev => ({ ...prev, ...report }))
    setRefresh(r => r + 1)
  }

  const handleDelete = () => {
    setSelectedReport(null)
    setRefresh(r => r + 1)
  }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--color-border)' }}>
          <button
            onClick={() => setSelectedReport({})}
            style={{ width:'100%', fontSize:12, padding:'4px 0' }}
          >
            + New Report
          </button>
        </div>

        {reports.length === 0 && (
          <div style={{ padding:'10px 12px', color:'var(--color-text-muted)', fontSize:12 }}>
            No reports yet.
          </div>
        )}

        {reports.map(r => (
          <div
            key={r.id}
            onClick={() => setSelectedReport(r)}
            style={{
              padding:'8px 12px',
              cursor:'pointer',
              borderBottom:'1px solid var(--color-border)',
              background: selectedReport?.id === r.id ? 'var(--color-surface2)' : undefined,
              fontSize:13,
            }}
          >
            <div style={{ fontWeight:500 }}>{r.name}</div>
            {r.description && (
              <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:2 }}>{r.description}</div>
            )}
          </div>
        ))}
      </div>

      {/* Main panel */}
      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        {selectedReport === null && (
          <div style={{ color:'var(--color-text-muted)', fontSize:13 }}>
            Select a report from the list, or create a new one.
          </div>
        )}

        {selectedReport !== null && (
          loading && selectedReport?.id ? (
            <div style={{ fontSize:13, color:'var(--color-text-muted)' }}>Loading report…</div>
          ) : (
            <ReportBuilder
              report={selectedReport?.id ? selectedReport : null}
              startDate={startDate}
              endDate={endDate}
              addressLabels={addressLabels}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          )
        )}
      </div>
    </div>
  )
}
