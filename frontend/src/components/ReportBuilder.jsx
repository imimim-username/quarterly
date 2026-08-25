import React, { useState, useEffect, useRef, useCallback } from 'react'
import { listQueries, createReport, updateReport, deleteReport, bulkSaveReportInstances, listColorSchemes } from '../api/client.js'
import ReportInstanceCard, { defaultInstanceConfig } from './ReportInstanceCard.jsx'
import ReportThemeEditor from './ReportThemeEditor.jsx'
import { buildZipBytes } from '../utils/zipBuilder.js'

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
 * Try to open a native folder picker (File System Access API).
 * Returns { dirHandle, cancelled, error }.
 *   dirHandle  — FileSystemDirectoryHandle on success
 *   cancelled  — true if the user dismissed the picker
 *   error      — non-null if the API is unavailable or threw unexpectedly
 *
 * Falls back gracefully: callers treat dirHandle=null as "use ZIP download".
 */
async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    // API absent — browser doesn't support it or a privacy setting blocks it.
    return { dirHandle: null, cancelled: false, error: 'unavailable' }
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    return { dirHandle, cancelled: false, error: null }
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { dirHandle: null, cancelled: true, error: null }
    }
    console.error('[pickDirectory]', e)
    return { dirHandle: null, cancelled: false, error: e?.message ?? String(e) }
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

/**
 * Fallback for browsers where showDirectoryPicker is unavailable.
 * Bundles all PNGs into a single ZIP and triggers one download dialog.
 */
function downloadAsZip(pngs) {
  const files = pngs.map(({ dataUrl, filename }) => {
    const base64 = dataUrl.split(',')[1]
    const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    return { name: filename, data }
  })
  const zipBytes = buildZipBytes(files)
  const blob = new Blob([zipBytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'report_charts.zip'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ─── Temp instance ID counter (client-side only) ──────────────────────────────

let tempIdCounter = 0
function nextTempId() { return `tmp_${++tempIdCounter}` }

// ─── Default filename builder ─────────────────────────────────────────────────

/**
 * Build the default export filename for a chart instance.
 * Format: [label]_YYYY-MM-DD_to_YYYY-MM-DD.png
 * Characters invalid in filenames are replaced with underscores.
 */
function buildDefaultFilename(label, startDate, endDate) {
  const safe = (label || 'chart')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/_+/g, '_')
    .trim()
  // Accept both Date objects and ISO strings
  const toYMD = d => {
    if (!d) return null
    if (d instanceof Date) return d.toISOString().slice(0, 10)
    return String(d).slice(0, 10)
  }
  const s = toYMD(startDate) ?? 'start'
  const e = toYMD(endDate)   ?? 'end'
  return `${safe}_${s}_to_${e}.png`
}

// ─── PngExportModal ───────────────────────────────────────────────────────────

/**
 * Pre-generation modal shown when "Generate PNGs" is clicked.
 * Lists all chart instances with editable filenames and checkboxes.
 * Warns on duplicate filenames. Calls onConfirm with the selected items.
 *
 * Props:
 *   instances  — current instances array
 *   startDate  — ISO date string (master range start)
 *   endDate    — ISO date string (master range end)
 *   onConfirm([{ tempId, filename, label }]) — called on OK
 *   onCancel() — called on Cancel / Escape / backdrop
 */
function PngExportModal({ instances, startDate, endDate, onConfirm, onCancel }) {
  const [items, setItems] = useState(() =>
    instances.map(inst => ({
      tempId:   inst._tempId,
      label:    inst.label || inst.query?.name || '(unlabeled)',
      filename: buildDefaultFilename(
        inst.label || inst.query?.name || 'chart',
        startDate,
        endDate,
      ),
      checked: true,
    }))
  )

  // Auto-focus the backdrop so Escape works immediately on open
  const backdropRef = useRef(null)
  useEffect(() => { backdropRef.current?.focus() }, [])

  // ── Conflict detection (derived — no extra state) ──
  // Only count filenames for checked items: unchecked charts won't be generated,
  // so their filenames don't participate in conflict detection.
  const counts = {}
  for (const it of items) {
    if (!it.checked) continue
    const k = it.filename.trim().toLowerCase()
    counts[k] = (counts[k] || 0) + 1
  }
  const isConflict = it => it.checked && counts[it.filename.trim().toLowerCase()] > 1
  const anyConflict = items.some(isConflict)

  const setFilename = (tempId, value) =>
    setItems(prev => prev.map(it => it.tempId === tempId ? { ...it, filename: value } : it))

  const setChecked = (tempId, checked) =>
    setItems(prev => prev.map(it => it.tempId === tempId ? { ...it, checked } : it))

  const selectAll  = () => setItems(prev => prev.map(it => ({ ...it, checked: true  })))
  const selectNone = () => setItems(prev => prev.map(it => ({ ...it, checked: false })))

  const handleConfirm = () => {
    onConfirm(
      items
        .filter(it => it.checked)
        .map(it => {
          const raw = it.filename.trim() || buildDefaultFilename(it.label, startDate, endDate)
          // Always ensure the filename ends with .png (case-insensitive)
          const withExt = raw.toLowerCase().endsWith('.png') ? raw : `${raw}.png`
          return { tempId: it.tempId, filename: withExt, label: it.label }
        })
    )
  }

  const handleKeyDown = e => { if (e.key === 'Escape') onCancel() }
  const handleBackdrop = e => { if (e.target === e.currentTarget) onCancel() }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '24px 28px',
        width: 660, maxWidth: '95vw', maxHeight: '80vh',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* Header */}
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
          ⬇ Export PNGs
        </div>

        {/* Select all / none */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={selectAll}
            style={{ fontSize: 12, padding: '3px 12px', background: 'var(--color-surface2)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
          >Select all</button>
          <button
            onClick={selectNone}
            style={{ fontSize: 12, padding: '3px 12px', background: 'var(--color-surface2)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
          >Select none</button>
        </div>

        {/* Chart list */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
          {items.map(it => (
            <div key={it.tempId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={it.checked}
                onChange={e => setChecked(it.tempId, e.target.checked)}
                style={{ flexShrink: 0, accentColor: 'var(--color-accent)', width: 15, height: 15 }}
              />
              <span
                title={it.label}
                style={{
                  fontSize: 12, color: 'var(--color-text-muted)',
                  width: 150, flexShrink: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {it.label}
              </span>
              <input
                value={it.filename}
                onChange={e => setFilename(it.tempId, e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1, boxSizing: 'border-box',
                  padding: '5px 9px', fontSize: 12,
                  background: 'var(--color-surface2)',
                  color: 'var(--color-text)',
                  border: `1px solid ${isConflict(it) ? 'var(--color-error)' : 'var(--color-border)'}`,
                  borderRadius: 5,
                  fontFamily: 'monospace',
                  outline: isConflict(it) ? '1px solid var(--color-error)' : 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* Conflict warning */}
        {anyConflict && (
          <div style={{
            fontSize: 12, color: 'var(--color-error)',
            padding: '7px 10px',
            background: 'rgba(220,50,50,0.1)',
            borderRadius: 5, border: '1px solid var(--color-error)',
          }}>
            ⚠ Duplicate filenames — in folder mode, later files will overwrite earlier ones with the same name.
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', border: '1px solid var(--color-border)',
              color: 'var(--color-text)', padding: '7px 20px',
              borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            style={{
              background: '#2a6e2a', border: '1px solid #4caf50',
              color: '#fff', padding: '7px 26px',
              borderRadius: 6, cursor: 'pointer',
              fontWeight: 600, fontSize: 13,
            }}
          >OK</button>
        </div>
      </div>
    </div>
  )
}

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

  // Export modal — shown before folder picker so user can select/rename charts
  const [showExportModal, setShowExportModal] = useState(false)

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
    setShowExportModal(false)
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
    try {
      await deleteReport(report.id)
      onDelete?.()
    } catch (e) {
      console.error('Failed to delete report:', e)
      alert(`Failed to delete report: ${e.message ?? 'Unknown error'}`)
    }
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

  /**
   * Runs in the background after the export modal is confirmed and the directory
   * is picked. selectedItems = [{ tempId, filename, label }].
   * Called with void so handleExportConfirm returns immediately and the UI stays live.
   */
  const runGenerateLoop = useCallback(async (dirHandle, selectedItems) => {
    const pngs = []   // ZIP fallback accumulator
    let saved = 0
    let cancelled = false

    for (let i = 0; i < selectedItems.length; i++) {
      if (cancelRef.current) { cancelled = true; break }

      const { tempId, filename, label } = selectedItems[i]
      const cardRef = cardRefs.current[tempId]
      if (!cardRef) continue

      setGenStatus(`${i + 1} / ${selectedItems.length}: ${label}`)

      try {
        const { dataUrl } = await cardRef.generate()
        if (!dataUrl) continue

        if (dirHandle) {
          await writePngToDir(dirHandle, filename, dataUrl)
          saved++
          setGenStatus(`${i + 1} / ${selectedItems.length}: ${label} ✓  (${saved} saved)`)
        } else {
          pngs.push({ dataUrl, filename })
          setGenStatus(`${i + 1} / ${selectedItems.length}: ${label} ✓`)
        }
      } catch (e) {
        console.error('Generate failed for instance', tempId, e)
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
      setGenStatus('Building ZIP…')
      await downloadAsZip(pngs)
      setGenStatus(
        cancelled
          ? `Cancelled — ${pngs.length} PNG${pngs.length !== 1 ? 's' : ''} bundled in ZIP.`
          : `✓ ${pngs.length} PNG${pngs.length !== 1 ? 's' : ''} downloaded as report_charts.zip.`
      )
    }

    setGenerating(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Step 1: open the export modal. */
  const handleGenerate = () => {
    if (instances.length === 0 || generating) return
    setShowExportModal(true)
  }

  /**
   * Step 2: called when the user clicks OK in the export modal.
   * showDirectoryPicker must be called from a user-gesture handler — this
   * callback fires synchronously from a button onClick, so it qualifies.
   */
  const handleExportConfirm = async (selectedItems) => {
    setShowExportModal(false)
    if (!selectedItems.length) return

    const { dirHandle, cancelled } = await pickDirectory()
    if (cancelled) return

    cancelRef.current = false
    setGenerating(true)
    setGenStatus(dirHandle ? 'Saving to folder…' : 'Generating PNGs…')

    void runGenerateLoop(dirHandle, selectedItems)
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
        {instances.length > 0 && (
          <div style={{ display:'flex', gap:6, alignItems:'center', marginLeft:'auto' }}>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{ background: generating ? '#1e4a1e' : '#2a6e2a', border:'1px solid #4caf50', color: generating ? '#6a9a6a' : '#fff', cursor: generating ? 'default' : 'pointer' }}
            >
              {generating ? '⟳ Saving…' : '⬇ Generate PNGs'}
            </button>
            {generating && (
              <button
                onClick={handleCancelGenerate}
                style={{ background:'transparent', border:'1px solid var(--color-error)', color:'var(--color-error)', fontSize:11, padding:'3px 8px' }}
              >
                ✕ Cancel
              </button>
            )}
          </div>
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

      {/* Folder-save availability hint — only shown when not currently generating */}
      {!generating && instances.length > 0 && !window.showDirectoryPicker && (
        <div style={{ fontSize:11, color:'var(--color-text-muted)', fontStyle:'italic' }}>
          ℹ️ Your browser doesn't support silent folder saving. PNGs will be bundled into a single ZIP download instead. Use Chrome or Edge to save files directly to a folder.
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

      {/* Export modal — shown before folder picker so user can select/rename charts */}
      {showExportModal && (
        <PngExportModal
          instances={instances}
          startDate={startDate}
          endDate={endDate}
          onConfirm={handleExportConfirm}
          onCancel={() => setShowExportModal(false)}
        />
      )}

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
