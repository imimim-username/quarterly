import React, { useState, useEffect, useRef } from 'react'
import { Sketch } from '@uiw/react-color'
import {
  listColorSchemes, createColorScheme, updateColorScheme,
  deleteColorScheme, setDefaultScheme,
} from '../api/client.js'

/** Small clickable color swatch — clicking opens an inline Sketch picker. */
function SwatchPicker({ color, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        title="Click to change color"
        onClick={() => setOpen(o => !o)}
        style={{
          width: 24, height: 24, borderRadius: 4, border: '2px solid rgba(255,255,255,0.25)',
          background: color, cursor: 'pointer', flexShrink: 0, padding: 0,
          boxSizing: 'border-box',
        }}
      />
      {open && (
        <div style={{ position: 'absolute', top: 28, left: 0, zIndex: 9999, colorScheme: 'light' }}>
          <Sketch
            color={color}
            onChange={(c) => onChange(c.hex)}
            style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
          />
        </div>
      )}
    </div>
  )
}

/** Palette editor: ordered list of colors, each with a SwatchPicker. Add / remove colors. */
function PaletteEditor({ colors, onChange }) {
  const addColor = () => onChange([...colors, '#888888'])
  const removeColor = (i) => onChange(colors.filter((_, idx) => idx !== i))
  const changeColor = (i, hex) => onChange(colors.map((c, idx) => idx === i ? hex : c))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {colors.map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <SwatchPicker color={c} onChange={(hex) => changeColor(i, hex)} />
          {colors.length > 1 && (
            <button
              onClick={() => removeColor(i)}
              title="Remove color"
              style={{
                background: 'none', border: 'none', color: 'var(--color-text-muted)',
                cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
              }}
            >×</button>
          )}
        </div>
      ))}
      <button
        onClick={addColor}
        title="Add color"
        style={{
          width: 24, height: 24, borderRadius: 4, border: '1px dashed var(--color-border)',
          background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
          fontSize: 16, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>
    </div>
  )
}

/** Inline editor for a single scheme row (name + colors). */
function SchemeEditor({ scheme, onSave, onCancel, saving }) {
  const [name, setName] = useState(scheme?.name || '')
  const [colors, setColors] = useState(scheme?.colors || ['#e94560', '#2196f3', '#4caf50', '#ff9800'])

  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <input
        placeholder="Scheme name…"
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4 }}
        autoFocus
      />
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          Colors (click a swatch to edit)
        </div>
        <PaletteEditor colors={colors} onChange={setColors} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onSave(name.trim(), colors)}
          disabled={saving || !name.trim() || colors.length === 0}
          style={{ fontSize: 12, padding: '4px 14px' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{ fontSize: 12, padding: '4px 14px', background: 'transparent' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * ColorSchemeManager — modal for creating, editing, deleting, and setting
 * the default color scheme. Opened via the "⚙ Schemes" button in the chart toolbar.
 */
export default function ColorSchemeManager({ onClose, onSchemesChange }) {
  const [schemes, setSchemes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null) // scheme id being edited, or 'new'
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  const reload = async () => {
    const { data } = await listColorSchemes()
    if (data) setSchemes(data)
    setLoading(false)
  }

  useEffect(() => {
    reload().catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const handleSetDefault = async (id) => {
    setActionError('')
    const { ok, data: res } = await setDefaultScheme(id)
    if (ok) {
      await reload()
      onSchemesChange?.()
    } else {
      setActionError(res?.message || 'Failed to set default')
    }
  }

  const handleDelete = async (id) => {
    setActionError('')
    const { ok, data: res } = await deleteColorScheme(id)
    if (ok) {
      await reload()
      onSchemesChange?.()
    } else {
      setActionError(res?.message || 'Failed to delete scheme')
    }
  }

  const handleSave = async (name, colors, id) => {
    setActionError('')
    setSaving(true)
    try {
      let result
      if (id === 'new') {
        result = await createColorScheme({ name, colors })
      } else {
        result = await updateColorScheme(id, { name, colors })
      }
      if (result.ok) {
        setEditingId(null)
        await reload()
        onSchemesChange?.()
      } else {
        setActionError(result.data?.message || 'Failed to save scheme')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg)', border: '1px solid var(--color-border)',
          borderRadius: 8, padding: 24,
          width: '100%', maxWidth: 560,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Color Schemes</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>

        {/* Scroll area */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>}
          {error && <div className="error-banner">{error}</div>}
          {actionError && <div className="error-banner" style={{ fontSize: 12 }}>{actionError}</div>}

          {schemes.map(scheme => (
            <div key={scheme.id}>
              {editingId === scheme.id ? (
                <SchemeEditor
                  scheme={scheme}
                  saving={saving}
                  onSave={(name, colors) => handleSave(name, colors, scheme.id)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                }}>
                  {/* Color swatches preview */}
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {scheme.colors.slice(0, 8).map((c, i) => (
                      <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c }} />
                    ))}
                  </div>
                  {/* Name + default badge */}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: scheme.is_default ? 600 : 400 }}>
                    {scheme.name}
                    {scheme.is_default && (
                      <span style={{
                        marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 10,
                        background: 'var(--color-accent)', color: '#fff', verticalAlign: 'middle',
                      }}>
                        default
                      </span>
                    )}
                  </span>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {!scheme.is_default && (
                      <button
                        onClick={() => handleSetDefault(scheme.id)}
                        title="Set as default scheme"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >Set default</button>
                    )}
                    <button
                      onClick={() => { setEditingId(scheme.id); setActionError('') }}
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >Edit</button>
                    {!scheme.is_default && (
                      <button
                        onClick={() => handleDelete(scheme.id)}
                        title="Delete this scheme"
                        style={{ fontSize: 11, padding: '2px 8px', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
                      >Delete</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* New scheme form */}
          {editingId === 'new' ? (
            <SchemeEditor
              scheme={null}
              saving={saving}
              onSave={(name, colors) => handleSave(name, colors, 'new')}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <button
              onClick={() => { setEditingId('new'); setActionError('') }}
              style={{
                fontSize: 12, padding: '6px 14px', alignSelf: 'flex-start',
                background: 'transparent', border: '1px dashed var(--color-border)',
              }}
            >
              + New Scheme
            </button>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, textAlign: 'right' }}>
          <button onClick={onClose} style={{ fontSize: 12, padding: '4px 16px' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
