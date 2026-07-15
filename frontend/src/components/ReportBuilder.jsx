import React, { useState, useEffect, useRef, useCallback } from 'react'
import { listQueries, createReport, updateReport, deleteReport, bulkSaveReportInstances, listColorSchemes } from '../api/client.js'
import ReportInstanceCard, { defaultInstanceConfig } from './ReportInstanceCard.jsx'
import ReportThemeEditor from './ReportThemeEditor.jsx'

// ─── Report-level theme helpers ───────────────────────────────────────────────

export function defaultReportTheme() {
  return {
    palette:    ['#e94560', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4'],
    bg:         '#1a1f2e',
    bgAlpha:    100,
    textColor:  '#c0c0c0',
    gridColor:  '#333333',
    axisColor:  '#555555',
    fontFamily: 'Montserrat',
  }
}

function normaliseTheme(partial) {
  const defaults = defaultReportTheme()
  if (!partial || typeof partial !== 'object') return defaults
  return {
    ...defaults,
    ...partial,
    palette: Array.isArray(partial.palette) && partial.palette.length
      ? partial.palette
      : defaults.palette,
    bgAlpha: typeof partial.bgAlpha === 'number' ? partial.bgAlpha : defaults.bgAlpha,
  }
}

// ─── PNG generation helpers ───────────────────────────────────────────────────

/**
 * Try to open a folder picker (File System Access API — Chrome/Edge only).
 * Returns a FileSystemDirectoryHandle or null if unsupported/cancelled.
 */
async function pickDirectory() {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return null // User cancelled or permission denied
  }
}

/** Write a base64 data-URL PNG to a directory entry. */
async function writePngToDir(dirHandle, filename, dataUrl) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  const base64 = dataUrl.split(',')[1]
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  await writable.write(bytes)
  await writable.close()
}

/** Fallback: trigger individual browser downloads for each PNG. */
async function downloadAsZip(pngs) {
  for (const { dataUrl, filename } of pngs) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    a.click()
    // Small delay so the browser can process each download before the next
    await new Promise(r => setTimeout(r, 300))
  }
}

// ─── Temp instance ID counter (client-side only) ──────────────────────────────

let tempIdCounter = 0
function nextTempId() { return `tmp_${++tempIdCounter}` }

// ─── ReportBuilder ────────────────────────────────────────────────────────────

/**
 * ReportBuilder — create/edit reports with chart instances.
 *
 * Props:
 *  report        — full report object (with instances[]) or null for new
 *  startDate, endDate — Date objects for the master date range
 *  onSave(report)
 *  onDelete()
 */
export default function ReportBuilder({ report, startDate, endDate, addressLabels = [], onSave, onDelete }) {
  const [name, setName] = useState(report?.name ?? '')
  const [description, setDescription] = useState(report?.description ?? '')
  const [instances, setInstances] = useState(() => normaliseInstances(report?.instances ?? []))
  const [allQueries, setAllQueries] = useState([])
  const [reportTheme, setReportTheme] = useState(() => normaliseTheme(report?.config?.theme))
  const [saving, setSaving] = useState(false)
  const [saveFlash, setSaveFlash] = useState('') // '' | 'saved' | 'error'
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('') // progress text
  const [error, setError] = useState('')
  const [showQueryPicker, setShowQueryPicker] = useState(false)

  // Refs to each ReportInstanceCard (keyed by instance tempId)
  const cardRefs = useRef({})

  // Set to true by the Cancel button to break out of the generate loop
  const cancelRef = useRef(false)

  useEffect(() => {
    listQueries().then(({ data }) => setAllQueries(Array.isArray(data) ? data : []))
    // Only apply the default color scheme if this report has no saved theme
    listColorSchemes().then(({ data }) => {
      if (report?.config?.theme) return // already has a saved theme
      const schemes = Array.isArray(data) ? data : []
      const def = schemes.find(s => s.is_default) ?? schemes[0]
      if (!def) return
      try {
        const colors = typeof def.colors === 'string' ? JSON.parse(def.colors) : def.colors
        let schemeTheme = {}
        try { schemeTheme = def.theme ? (typeof def.theme === 'string' ? JSON.parse(def.theme) : def.theme) : {} } catch {}
        const patch = { ...schemeTheme }
        if (Array.isArray(colors) && colors.length) patch.palette = colors
        setReportTheme(t => normaliseTheme({ ...t, ...patch }))
      } catch {}
    })
  }, [])

  // Sync when report prop changes (e.g. switching selected report)
  useEffect(() => {
    setName(report?.name ?? '')
    setDescription(report?.description ?? '')
    setInstances(normaliseInstances(report?.instances ?? []))
    setReportTheme(normaliseTheme(report?.config?.theme))
    setError('')
    setGenStatus('')
    cardRefs.current = {}
  }, [report?.id])

  // ── Save report ──

  const handleSave = async () => {
    if (!name.trim()) { setError('Report name is required.'); return }
    setSaving(true); setError('')
    try {
      let saved
      if (report?.id) {
        const r = await updateReport(report.id, { name: name.trim(), description, config: { theme: reportTheme } })
        if (!r.ok) throw new Error(r.data?.message || 'Save failed.')
        saved = r.data
        // Bulk-save instances
        const payload = instances.map((inst, idx) => ({
          query_id: inst.query_id,
          label: inst.label,
          position: idx,
          config: inst.config,
        }))
        const ir = await bulkSaveReportInstances(report.id, payload)
        if (!ir.ok) throw new Error(ir.data?.message || 'Failed to save instances.')
      } else {
        // Create new
        const r = await createReport({ name: name.trim(), description, config: { theme: reportTheme } })
        if (!r.ok) throw new Error(r.data?.message || 'Create failed.')
        saved = r.data
        const payload = instances.map((inst, idx) => ({
          query_id: inst.query_id,
          label: inst.label,
          position: idx,
          config: inst.config,
        }))
        if (payload.length) {
          const ir = await bulkSaveReportInstances(saved.id, payload)
          if (!ir.ok) throw new Error(ir.data?.message || 'Failed to save instances.')
        }
      }
      onSave?.(saved)
      setSaveFlash('saved')
      setTimeout(() => setSaveFlash(''), 2500)
    } catch (e) {
      setError(e.message)
      setSaveFlash('error')
      setTimeout(() => setSaveFlash(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete report ──

  const handleDelete = async () => {
    if (!report?.id) return
    if (!window.confirm(`Delete report "${name}"?`)) return
    await deleteReport(report.id)
    onDelete?.()
  }

  // ── Add instance ──

  const addInstance = (queryId) => {
    const q = allQueries.find(q => q.id === Number(queryId))
    setInstances(prev => [...prev, {
      _tempId: nextTempId(),
      query_id: Number(queryId),
      label: '',
      config: defaultInstanceConfig(),
      query: q,
    }])
    setShowQueryPicker(false)
  }

  // ── Update instance ──

  const updateInstance = useCallback((tempId, patch) => {
    setInstances(prev => prev.map(inst =>
      inst._tempId === tempId ? { ...inst, ...patch } : inst
    ))
  }, [])

  // ── Delete instance ──

  const deleteInstance = (tempId) => {
    setInstances(prev => prev.filter(inst => inst._tempId !== tempId))
    delete cardRefs.current[tempId]
  }

  // ── Clone instance ──

  const cloneInstance = (tempId) => {
    setInstances(prev => {
      const idx = prev.findIndex(inst => inst._tempId === tempId)
      if (idx < 0) return prev
      const src = prev[idx]
      const clone = {
        ...src,
        _tempId: nextTempId(),
        id: undefined,            // treat as unsaved
        label: src.label ? `${src.label} (copy)` : '(copy)',
        config: { ...src.config },
      }
      const next = [...prev]
      next.splice(idx + 1, 0, clone)
      return next
    })
  }

  // ── Move instance up/down ──

  const moveInstance = (tempId, dir) => {
    setInstances(prev => {
      const idx = prev.findIndex(inst => inst._tempId === tempId)
      if (idx < 0) return prev
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  // ── Generate PNGs ──

  const handleGenerate = async () => {
    if (instances.length === 0) return
    cancelRef.current = false
    setGenerating(true)
    setGenStatus('Preparing…')
    setError('')

    // Pick destination folder up-front so we can write each PNG immediately.
    // Fallback: accumulate in memory and ZIP at the end.
    const dirHandle = await pickDirectory()

    const pngs = []   // used only in ZIP fallback mode
    let saved = 0
    let cancelled = false

    for (let i = 0; i < instances.length; i++) {
      if (cancelRef.current) { cancelled = true; break }

      const inst = instances[i]
      const cardRef = cardRefs.current[inst._tempId]
      if (!cardRef) continue

      const label = inst.label || inst.query?.name || '…'
      setGenStatus(`${i + 1} / ${instances.length}: ${label}`)

      try {
        const { dataUrl, filename } = await cardRef.generate()
        if (!dataUrl) continue

        if (dirHandle) {
          // Write immediately — progress is preserved even if cancelled later
          await writePngToDir(dirHandle, filename, dataUrl)
          saved++
          setGenStatus(`${i + 1} / ${instances.length}: ${label} ✓  (${saved} saved)`)
        } else {
          pngs.push({ dataUrl, filename })
          setGenStatus(`${i + 1} / ${instances.length}: ${label} ✓`)
        }
      } catch (e) {
        console.error('Generate failed for instance', inst, e)
      }
    }

    if (dirHandle) {
      setGenStatus(
        cancelled
          ? `Cancelled — ${saved} PNG${saved !== 1 ? 's' : ''} already saved to folder.`
          : `✓ Saved ${saved} PNG${saved !== 1 ? 's' : ''} to folder.`
      )
    } else {
      if (pngs.length === 0) {
        setGenStatus(cancelled ? 'Cancelled — nothing was saved.' : 'No charts could be generated.')
        setGenerating(false)
        return
      }
      setGenStatus(`Downloading ${pngs.length} PNG${pngs.length > 1 ? 's' : ''}…`)
      await downloadAsZip(pngs)
      setGenStatus(
        cancelled
          ? `Cancelled — downloaded ${pngs.length} PNG${pngs.length !== 1 ? 's' : ''} completed so far.`
          : `✓ Downloaded ${pngs.length} PNG${pngs.length !== 1 ? 's' : ''}.`
      )
    }

    setGenerating(false)
  }

  const handleCancelGenerate = () => {
    cancelRef.current = true
    setGenStatus(prev => prev + '  (cancelling…)')
  }

  const isNew = !report?.id

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {error && <div className="error-banner">{error}</div>}

      {/* Name + description */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div className="form-group" style={{ margin:0 }}>
          <label>Report Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Q2 2026 Summary" />
        </div>
        <div className="form-group" style={{ margin:0 }}>
          <label>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : (isNew ? 'Create Report' : 'Save')}
        </button>
        <button
          onClick={() => setShowQueryPicker(p => !p)}
          style={{ background:'var(--color-surface2)', border:'1px solid var(--color-border)' }}
        >
          + Add Chart Instance
        </button>
        {instances.length > 0 && !generating && (
          <button
            onClick={handleGenerate}
            style={{ background:'#2a6e2a', border:'1px solid #4caf50', color:'#fff', marginLeft:'auto' }}
          >
            ⬇ Generate PNGs
          </button>
        )}
        {generating && (
          <button
            onClick={handleCancelGenerate}
            style={{ background:'#6e2a2a', border:'1px solid #f44336', color:'#fff', marginLeft:'auto' }}
          >
            ✕ Cancel
          </button>
        )}
        {!isNew && (
          <button
            onClick={handleDelete}
            style={{ marginLeft: instances.length > 0 ? 0 : 'auto', background:'transparent', borderColor:'var(--color-error)', color:'var(--color-error)' }}
          >
            Delete Report
          </button>
        )}
      </div>

      {/* Gen status message */}
      {genStatus && (
        <div style={{ fontSize:12, color: generating ? 'var(--color-text-muted)' : 'var(--color-success)' }}>
          {genStatus}
        </div>
      )}

      {/* Chart theme editor */}
      <ReportThemeEditor
        theme={reportTheme}
        onChange={setReportTheme}
        defaultTheme={defaultReportTheme()}
      />

      {/* Query picker dropdown */}
      {showQueryPicker && (
        <div style={{
          border:'1px solid var(--color-border)', borderRadius:6,
          background:'var(--color-surface2)', padding:10,
          display:'flex', flexDirection:'column', gap:4,
          maxHeight:240, overflowY:'auto',
        }}>
          <div style={{ fontSize:12, color:'var(--color-text-muted)', marginBottom:4 }}>
            Select a query to add as a new chart instance:
          </div>
          {allQueries.map(q => (
            <button
              key={q.id}
              onClick={() => addInstance(q.id)}
              style={{ textAlign:'left', background:'transparent', border:'1px solid transparent', padding:'4px 8px', fontSize:12 }}
            >
              <span style={{ color:'var(--color-text-muted)' }}>{q.category} / </span>
              {q.name}
            </button>
          ))}
          {allQueries.length === 0 && (
            <span style={{ fontSize:12, color:'var(--color-text-muted)' }}>No queries found.</span>
          )}
          <button
            onClick={() => setShowQueryPicker(false)}
            style={{ marginTop:6, background:'transparent', fontSize:11 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Instance cards */}
      {instances.length === 0 && !showQueryPicker && (
        <div style={{ fontSize:12, color:'var(--color-text-muted)', padding:'16px 0', textAlign:'center' }}>
          No chart instances yet. Click "+ Add Chart Instance" to begin.
        </div>
      )}

      {instances.map((inst, idx) => (
        <div key={inst._tempId} style={{ display:'flex', gap:6, alignItems:'flex-start' }}>
          {/* Reorder buttons */}
          <div style={{ display:'flex', flexDirection:'column', gap:2, paddingTop:8 }}>
            <button
              onClick={() => moveInstance(inst._tempId, -1)}
              disabled={idx === 0}
              style={{ fontSize:10, padding:'2px 5px', background:'transparent', opacity: idx===0?0.3:1 }}
              title="Move up"
            >▲</button>
            <button
              onClick={() => moveInstance(inst._tempId, 1)}
              disabled={idx === instances.length - 1}
              style={{ fontSize:10, padding:'2px 5px', background:'transparent', opacity:idx===instances.length-1?0.3:1 }}
              title="Move down"
            >▼</button>
          </div>

          <div style={{ flex:1 }}>
            <ReportInstanceCard
              ref={el => { cardRefs.current[inst._tempId] = el }}
              instance={inst}
              allQueries={allQueries}
              startDate={startDate}
              endDate={endDate}
              reportTheme={reportTheme}
              addressLabels={addressLabels}
              onUpdate={patch => updateInstance(inst._tempId, patch)}
              onDelete={() => deleteInstance(inst._tempId)}
              onClone={() => cloneInstance(inst._tempId)}
            />
          </div>
        </div>
      ))}

      {/* Floating save button — always visible while editing */}
      <button
        onClick={handleSave}
        disabled={saving}
        title={isNew ? 'Create report and save all chart configurations' : 'Save report and all chart configurations'}
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          zIndex: 1200,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '10px 18px',
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 28,
          border: 'none',
          cursor: saving ? 'default' : 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          background: saveFlash === 'saved'  ? '#2a6e2a'
                    : saveFlash === 'error'  ? '#6e2a2a'
                    : saving                 ? 'var(--color-surface2)'
                    : 'var(--color-accent)',
          color: saving ? 'var(--color-text-muted)' : '#fff',
          transition: 'background 0.25s',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>
          {saving                        ? '⟳'
           : saveFlash === 'saved'       ? '✓'
           : saveFlash === 'error'       ? '⚠'
           : '💾'}
        </span>
        {saving                    ? 'Saving…'
         : saveFlash === 'saved'   ? 'Saved!'
         : saveFlash === 'error'   ? 'Save failed'
         : isNew                   ? 'Create & Save'
         : 'Save'}
      </button>
    </div>
  )
}

// ─── Normalise instances from server ─────────────────────────────────────────

function normaliseInstances(serverInstances) {
  return (serverInstances ?? []).map(inst => ({
    ...inst,
    _tempId: nextTempId(),
    config: { ...defaultInstanceConfig(), ...(inst.config ?? {}) },
  }))
}
