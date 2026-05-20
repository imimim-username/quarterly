import React, { useState, useEffect, useRef, useCallback } from 'react'
import { listQueries, exportBundle, previewImport, commitImport } from '../api/client.js'

const FIELD_GROUPS = [
  { key: 'gql',       label: 'GraphQL' },
  { key: 'variables', label: 'Variables' },
  { key: 'display',   label: 'Display (field labels, chart views)' },
  { key: 'info',      label: 'Info (description, category)' },
  { key: 'execution', label: 'Execution (pagination, chain, dates)' },
]

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const isNew = status === 'new'
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
      background: isNew ? 'rgba(76,175,80,0.2)' : 'rgba(255,152,0,0.2)',
      color: isNew ? 'var(--color-success)' : 'var(--color-warning)',
      border: `1px solid ${isNew ? 'var(--color-success)' : 'var(--color-warning)'}`,
    }}>
      {isNew ? '● New' : '⚠ Conflict'}
    </span>
  )
}

function SectionHeader({ label, count, allChecked, onToggleAll }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>({count})</span>
      )}
      <span style={{ flex: 1 }} />
      <button
        onClick={() => onToggleAll(true)}
        style={{ fontSize: 11, padding: '1px 8px', background: 'none', border: '1px solid var(--color-border)' }}
      >All</button>
      <button
        onClick={() => onToggleAll(false)}
        style={{ fontSize: 11, padding: '1px 8px', background: 'none', border: '1px solid var(--color-border)' }}
      >None</button>
    </div>
  )
}

// ─── Export Tab ───────────────────────────────────────────────────────────────

function ExportTab() {
  const [queries, setQueries] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [includeAddressLabels, setIncludeAddressLabels] = useState(true)
  const [includeSettings, setIncludeSettings] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [loadingQueries, setLoadingQueries] = useState(true)

  useEffect(() => {
    listQueries().then(res => {
      if (res.ok) {
        setQueries(res.data)
        setSelectedIds(new Set(res.data.map(q => q.id)))
      }
      setLoadingQueries(false)
    })
  }, [])

  const toggleId = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleAll = (on) => setSelectedIds(on ? new Set(queries.map(q => q.id)) : new Set())

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const queryIds = selectedIds.size === queries.length ? null : [...selectedIds]
      const res = await exportBundle({ queryIds, includeAddressLabels, includeSettings })
      if (!res.ok) { setError(res.data?.message || 'Export failed.'); return }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `quarterly-export-${date}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  // Group queries by category
  const grouped = queries.reduce((acc, q) => {
    const cat = q.category || 'Uncategorized'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(q)
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Queries section */}
      <div>
        <SectionHeader
          label="Queries"
          count={queries.length}
          onToggleAll={toggleAll}
        />
        {loadingQueries ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Loading…</div>
        ) : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
            {Object.entries(grouped).map(([cat, qs]) => (
              <div key={cat}>
                <div style={{
                  padding: '4px 10px',
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-surface2)',
                  position: 'sticky', top: 0,
                }}>
                  {cat}
                </div>
                {qs.map(q => (
                  <label key={q.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px', cursor: 'pointer', fontSize: 13,
                    borderBottom: '1px solid var(--color-border)',
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(q.id)}
                      onChange={() => toggleId(q.id)}
                    />
                    {q.name}
                    {q.is_builtin ? (
                      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>[built-in]</span>
                    ) : null}
                  </label>
                ))}
              </div>
            ))}
            {queries.length === 0 && (
              <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>No queries found.</div>
            )}
          </div>
        )}
      </div>

      {/* Address book + settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeAddressLabels} onChange={e => setIncludeAddressLabels(e.target.checked)} />
          Address Book
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeSettings} onChange={e => setIncludeSettings(e.target.checked)} />
          Settings
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div>
        <button
          onClick={handleExport}
          disabled={exporting || (selectedIds.size === 0 && !includeAddressLabels && !includeSettings)}
          style={{ padding: '6px 18px' }}
        >
          {exporting ? 'Exporting…' : `Download Export File`}
        </button>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 12 }}>
          {selectedIds.size} {selectedIds.size === 1 ? 'query' : 'queries'} selected
        </span>
      </div>
    </div>
  )
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

const DEFAULT_QUERY_FIELDS = ['gql', 'variables', 'display', 'info', 'execution']

function ImportTab() {
  const fileRef = useRef(null)
  const [step, setStep] = useState('pick') // 'pick' | 'preview' | 'result'
  const [bundle, setBundle] = useState(null)
  const [preview, setPreview] = useState(null)
  const [decisions, setDecisions] = useState({ queries: [], addressLabels: [], settings: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [dragging, setDragging] = useState(false)

  const loadFile = useCallback(async (file) => {
    setError('')
    setLoading(true)
    try {
      const text = await file.text()
      let parsed
      try { parsed = JSON.parse(text) } catch {
        setError('Invalid JSON file.'); setLoading(false); return
      }
      if (typeof parsed.schemaVersion !== 'number') {
        setError('Not a valid quarterly export file (missing schemaVersion).'); setLoading(false); return
      }
      const res = await previewImport(parsed)
      if (!res.ok) { setError(res.data?.message || 'Preview failed.'); setLoading(false); return }

      setBundle(parsed)
      setPreview(res.data)

      // Build default decisions
      const queryDecs = (res.data.queries || []).map(q => ({
        name: q.name,
        action: q.status === 'new' ? 'create' : 'overwrite',
        include: true,
        fields: [...DEFAULT_QUERY_FIELDS],
      }))
      const labelDecs = (res.data.addressLabels || []).map(l => ({
        address: l.address,
        chain: l.chain,
        action: l.status === 'new' ? 'create' : 'overwrite',
        include: true,
      }))
      const settingKeys = res.data.settings ? Object.keys(res.data.settings.incoming || {}) : []
      setDecisions({ queries: queryDecs, addressLabels: labelDecs, settings: settingKeys })
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFilePick = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]) }
  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  // Query decision helpers
  const setQueryDec = (name, patch) => setDecisions(prev => ({
    ...prev,
    queries: prev.queries.map(d => d.name === name ? { ...d, ...patch } : d),
  }))
  const toggleAllQueries = (on) => setDecisions(prev => ({ ...prev, queries: prev.queries.map(d => ({ ...d, include: on })) }))

  // Label decision helpers
  const setLabelDec = (address, chain, patch) => setDecisions(prev => ({
    ...prev,
    addressLabels: prev.addressLabels.map(d => d.address === address && d.chain === chain ? { ...d, ...patch } : d),
  }))
  const toggleAllLabels = (on) => setDecisions(prev => ({ ...prev, addressLabels: prev.addressLabels.map(d => ({ ...d, include: on })) }))

  // Setting helpers
  const toggleSetting = (key) => setDecisions(prev => {
    const next = prev.settings.includes(key) ? prev.settings.filter(k => k !== key) : [...prev.settings, key]
    return { ...prev, settings: next }
  })
  const toggleAllSettings = (on) => {
    const keys = Object.keys(preview?.settings?.incoming || {})
    setDecisions(prev => ({ ...prev, settings: on ? keys : [] }))
  }

  const handleImport = async () => {
    setLoading(true)
    setError('')
    try {
      // Build decisions payload
      const queryPayload = decisions.queries
        .filter(d => d.include)
        .map(d => ({
          name: d.name,
          action: d.action === 'create' ? 'create_new' : d.action,
          fields: d.fields,
        }))
      const labelPayload = decisions.addressLabels
        .filter(d => d.include)
        .map(d => ({
          address: d.address,
          chain: d.chain,
          action: d.action === 'create' ? 'create' : d.action,
        }))
      const res = await commitImport({ bundle, decisions: { queries: queryPayload, addressLabels: labelPayload, settings: decisions.settings } })
      if (!res.ok) { setError(res.data?.message || 'Import failed.'); return }
      setImportResult(res.data)
      setStep('result')
    } finally {
      setLoading(false)
    }
  }

  const includedCount = (decisions.queries.filter(d => d.include).length)
    + (decisions.addressLabels.filter(d => d.include).length)
    + decisions.settings.length

  // ── Step: file pick ──
  if (step === 'pick') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
            borderRadius: 8,
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            color: dragging ? 'var(--color-accent)' : 'var(--color-text-muted)',
            transition: 'border-color 0.15s, color 0.15s',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 14 }}>Drop a <strong>.json</strong> export file here, or click to choose</div>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFilePick} />
        </div>
        {loading && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Analyzing file…</div>}
        {error && <div className="error-banner">{error}</div>}
      </div>
    )
  }

  // ── Step: result ──
  if (step === 'result') {
    const r = importResult || {}
    const qCreated  = (r.queries || []).filter(x => x.action === 'created').length
    const qUpdated  = (r.queries || []).filter(x => x.action === 'updated').length
    const qSkipped  = (r.queries || []).filter(x => x.action === 'skipped').length
    const lCreated  = (r.addressLabels || []).filter(x => x.action === 'created').length
    const lUpdated  = (r.addressLabels || []).filter(x => x.action === 'updated').length
    const lSkipped  = (r.addressLabels || []).filter(x => x.action === 'skipped').length
    const sImported = (r.settings || []).length

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>✓ Import complete</div>
        <table className="results-table" style={{ fontSize: 12 }}>
          <tbody>
            {(qCreated + qUpdated + qSkipped) > 0 && (
              <tr>
                <td style={{ color: 'var(--color-text-muted)' }}>Queries</td>
                <td>{qCreated} created, {qUpdated} updated, {qSkipped} skipped</td>
              </tr>
            )}
            {(lCreated + lUpdated + lSkipped) > 0 && (
              <tr>
                <td style={{ color: 'var(--color-text-muted)' }}>Address labels</td>
                <td>{lCreated} created, {lUpdated} updated, {lSkipped} skipped</td>
              </tr>
            )}
            {sImported > 0 && (
              <tr>
                <td style={{ color: 'var(--color-text-muted)' }}>Settings</td>
                <td>{sImported} updated</td>
              </tr>
            )}
          </tbody>
        </table>
        <div>
          <button onClick={() => { setStep('pick'); setBundle(null); setPreview(null); setImportResult(null) }}>
            Import another file
          </button>
        </div>
      </div>
    )
  }

  // ── Step: preview ──
  const previewQueries = preview?.queries || []
  const previewLabels = preview?.addressLabels || []
  const previewSettings = preview?.settings || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* File metadata */}
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {preview.exportedAt && <span>Exported: {new Date(preview.exportedAt).toLocaleString()}</span>}
        {preview.appVersion && <span>App version: {preview.appVersion}</span>}
        <span>Schema version: {preview.schemaVersion}</span>
      </div>

      {/* Queries */}
      {previewQueries.length > 0 && (
        <div>
          <SectionHeader label="Queries" count={previewQueries.length} onToggleAll={toggleAllQueries} />
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 340, overflow: 'auto' }}>
            {decisions.queries.map((dec, i) => {
              const pq = previewQueries[i]
              if (!pq) return null
              return (
                <div key={dec.name} style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  opacity: dec.include ? 1 : 0.45,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input type="checkbox" checked={dec.include} onChange={e => setQueryDec(dec.name, { include: e.target.checked })} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{pq.name}</span>
                    {pq.isBuiltin && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>[built-in]</span>}
                    <StatusBadge status={pq.status} />
                    {pq.status === 'conflict' && (
                      <select
                        value={dec.action}
                        onChange={e => setQueryDec(dec.name, { action: e.target.value })}
                        style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }}
                      >
                        <option value="overwrite">Overwrite</option>
                        <option value="create">Create new</option>
                        <option value="skip">Skip</option>
                      </select>
                    )}
                  </div>
                  {/* Field checkboxes for overwrite */}
                  {dec.include && dec.action === 'overwrite' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 22 }}>
                      {FIELD_GROUPS.map(fg => (
                        <label key={fg.key} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                          <input
                            type="checkbox"
                            checked={dec.fields.includes(fg.key)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...dec.fields, fg.key]
                                : dec.fields.filter(f => f !== fg.key)
                              setQueryDec(dec.name, { fields: next })
                            }}
                          />
                          {fg.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Address labels */}
      {previewLabels.length > 0 && (
        <div>
          <SectionHeader label="Address Book" count={previewLabels.length} onToggleAll={toggleAllLabels} />
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 240, overflow: 'auto' }}>
            {decisions.addressLabels.map((dec, i) => {
              const pl = previewLabels[i]
              if (!pl) return null
              return (
                <div key={`${dec.address}-${dec.chain}`} style={{
                  padding: '6px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  opacity: dec.include ? 1 : 0.45,
                  fontSize: 12,
                }}>
                  <input type="checkbox" checked={dec.include} onChange={e => setLabelDec(dec.address, dec.chain, { include: e.target.checked })} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {pl.address.slice(0, 8)}…{pl.address.slice(-6)}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{pl.chain || 'all chains'}</span>
                  <span style={{ fontWeight: 500 }}>{pl.name}</span>
                  <StatusBadge status={pl.status} />
                  {pl.status === 'conflict' && (
                    <>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                        (was: <em>{pl.existingName}</em>)
                      </span>
                      <select
                        value={dec.action}
                        onChange={e => setLabelDec(dec.address, dec.chain, { action: e.target.value })}
                        style={{ fontSize: 11, padding: '1px 6px' }}
                      >
                        <option value="overwrite">Overwrite</option>
                        <option value="skip">Skip</option>
                      </select>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Settings */}
      {previewSettings.incoming && Object.keys(previewSettings.incoming).length > 0 && (
        <div>
          <SectionHeader label="Settings" onToggleAll={toggleAllSettings} />
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {Object.entries(previewSettings.incoming).map(([key, val]) => {
              const current = previewSettings.current?.[key]
              return (
                <label key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                  borderBottom: '1px solid var(--color-border)', cursor: 'pointer', fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={decisions.settings.includes(key)}
                    onChange={() => toggleSetting(key)}
                  />
                  <span style={{ color: 'var(--color-text-muted)', minWidth: 120 }}>{key}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(val)}</span>
                  {current !== undefined && current !== String(val) && (
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                      (current: {String(current)})
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => { setStep('pick'); setError('') }} style={{ background: 'none' }}>← Back</button>
        <button
          onClick={handleImport}
          disabled={loading || includedCount === 0}
          style={{ padding: '6px 18px' }}
        >
          {loading ? 'Importing…' : `Import ${includedCount} item${includedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function ImportExportModal({ onClose }) {
  const [tab, setTab] = useState('export')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      background: 'var(--color-bg)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Import / Export</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ padding: '3px 10px', fontSize: 12 }}>✕ Close</button>
      </div>

      {/* Tab bar */}
      <div className="tab-bar" style={{ padding: '0 16px', marginBottom: 0 }}>
        {['export', 'import'].map(t => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {tab === 'export' ? <ExportTab /> : <ImportTab />}
        </div>
      </div>
    </div>
  )
}
