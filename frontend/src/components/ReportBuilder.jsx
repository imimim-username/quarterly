import React, { useState, useEffect } from 'react'
import { listQueries, createReport, updateReport, deleteReport, runReport, exportReportRunZip } from '../api/client.js'

/**
 * ReportBuilder — create/edit reports; add/remove queries; run all.
 */
export default function ReportBuilder({ report, startDate, endDate, onSave, onDelete, onRunComplete }) {
  const [name, setName] = useState(report?.name || '')
  const [description, setDescription] = useState(report?.description || '')
  const [queryIds, setQueryIds] = useState(report?.queries?.map(q => q.id) || [])
  const [allQueries, setAllQueries] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listQueries().then(({ data }) => setAllQueries(Array.isArray(data) ? data : []))
  }, [])

  useEffect(() => {
    if (report) {
      setName(report.name || '')
      setDescription(report.description || '')
      setQueryIds(report.queries?.map(q => q.id) || [])
    }
  }, [report])

  const handleSave = async () => {
    setError('')
    try {
      let result
      const payload = { name, description, query_ids: queryIds }
      if (report?.id) {
        result = await updateReport(report.id, payload)
      } else {
        result = await createReport({ name, description })
        if (result.ok && result.data?.id) {
          // Update with query_ids
          result = await updateReport(result.data.id, payload)
        }
      }
      if (!result.ok) {
        setError(result.data?.message || 'Save failed.')
        return
      }
      onSave && onSave(result.data)
    } catch (e) {
      setError('Save failed: ' + e.message)
    }
  }

  const handleDelete = async () => {
    if (!report?.id) return
    if (!window.confirm(`Delete report "${name}"?`)) return
    await deleteReport(report.id)
    onDelete && onDelete(report.id)
  }

  const handleRun = async () => {
    if (!report?.id) return
    setRunning(true)
    setError('')
    try {
      const body = {
        start_date: startDate ? startDate.toISOString() : null,
        end_date: endDate ? endDate.toISOString() : null,
      }
      const { data, ok } = await runReport(report.id, body)
      if (!ok) {
        setError(data?.message || 'Run failed.')
        return
      }
      onRunComplete && onRunComplete(data)
    } catch (e) {
      setError('Run failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  const toggleQuery = (qid) => {
    setQueryIds(prev => prev.includes(qid) ? prev.filter(id => id !== qid) : [...prev, qid])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-group">
        <label>Report Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Q2 2026 Report" />
      </div>
      <div className="form-group">
        <label>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} />
      </div>

      <div>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
          Queries (select to include)
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 250, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8 }}>
          {allQueries.map(q => (
            <label key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={queryIds.includes(q.id)} onChange={() => toggleQuery(q.id)} />
              <span>{q.category} / {q.name}</span>
            </label>
          ))}
          {allQueries.length === 0 && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No queries available.</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
        <button onClick={handleSave}>{report?.id ? 'Save' : 'Create'}</button>
        {report?.id && (
          <>
            <button
              onClick={handleRun}
              disabled={running || queryIds.length === 0}
              style={{ background: 'var(--color-accent)', border: 'none' }}
            >
              {running ? <><span className="spinner" style={{ marginRight: 6 }} />Running All…</> : '▶ Run All'}
            </button>
            <button onClick={handleDelete} style={{ marginLeft: 'auto', background: 'transparent', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
