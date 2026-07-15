import React, { useRef, useState } from 'react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure hex is always #rrggbb (input[type=color] requires 6-digit form). */
function normaliseHex(hex) {
  if (!hex || typeof hex !== 'string') return '#000000'
  const h = hex.replace('#', '')
  if (h.length === 3) return '#' + h.split('').map(c => c + c).join('')
  return hex.startsWith('#') ? hex : '#' + hex
}

/** Download a JSON file in the browser. */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── ColorRow — label + color picker + hex text ───────────────────────────────

function ColorRow({ label, value, onChange }) {
  const [text, setText] = useState(value)

  const handlePicker = (e) => {
    setText(e.target.value)
    onChange(e.target.value)
  }
  const handleText = (e) => {
    setText(e.target.value)
    const v = e.target.value.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) {
      onChange(normaliseHex(v))
    }
  }
  const handleBlur = () => setText(normaliseHex(value))

  // Sync when value changes from outside (e.g. import / reset)
  React.useEffect(() => { setText(value) }, [value])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 80, flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="color"
        value={normaliseHex(value)}
        onChange={handlePicker}
        style={{ width: 28, height: 22, border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
      />
      <input
        type="text"
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        maxLength={7}
        style={{ width: 72, fontSize: 11, fontFamily: 'monospace', padding: '2px 6px' }}
      />
    </div>
  )
}

// ─── PaletteEditor — series color swatches ────────────────────────────────────

function PaletteSwatch({ color, onColorChange, onRemove, canRemove }) {
  const [text, setText] = useState(color)

  const handlePicker = (e) => {
    setText(e.target.value)
    onColorChange(e.target.value)
  }
  const handleText = (e) => {
    setText(e.target.value)
    const v = e.target.value.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) {
      onColorChange(normaliseHex(v))
    }
  }
  const handleBlur = () => setText(normaliseHex(color))

  React.useEffect(() => { setText(color) }, [color])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <input
        type="color"
        value={normaliseHex(color)}
        onChange={handlePicker}
        title={color}
        style={{ width: 28, height: 22, border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
      />
      <input
        type="text"
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        maxLength={7}
        style={{ width: 52, fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', textAlign: 'center' }}
      />
      <button
        onClick={onRemove}
        disabled={!canRemove}
        style={{
          fontSize: 9, padding: '0 3px', background: 'transparent',
          color: 'var(--color-error)', border: 'none', cursor: 'pointer',
          opacity: canRemove ? 1 : 0.3,
        }}
        title="Remove color"
      >×</button>
    </div>
  )
}

function PaletteEditor({ colors, onChange }) {
  const addColor = () => onChange([...colors, '#888888'])
  const removeColor = (i) => onChange(colors.filter((_, idx) => idx !== i))
  const updateColor = (i, val) => onChange(colors.map((c, idx) => idx === i ? val : c))

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 5 }}>
        Series Colors
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
        {colors.map((color, i) => (
          <PaletteSwatch
            key={i}
            color={color}
            onColorChange={val => updateColor(i, val)}
            onRemove={() => removeColor(i)}
            canRemove={colors.length > 1}
          />
        ))}
        <button
          onClick={addColor}
          style={{ fontSize: 18, lineHeight: 1, padding: '0 4px', background: 'transparent', border: '1px dashed var(--color-border)', borderRadius: 3, color: 'var(--color-text-muted)', cursor: 'pointer', alignSelf: 'center' }}
          title="Add color"
        >+</button>
      </div>
    </div>
  )
}

// ─── ReportThemeEditor ────────────────────────────────────────────────────────

/**
 * Collapsible panel for editing per-report chart theme settings.
 *
 * Props:
 *  theme    — { palette, bg, bgAlpha, textColor, gridColor, axisColor }
 *  onChange — (newTheme) => void
 *  defaultTheme — the default to reset to
 */
export default function ReportThemeEditor({ theme, onChange, defaultTheme }) {
  const [open, setOpen] = useState(false)
  const importRef = useRef(null)

  const update = (key, val) => onChange({ ...theme, [key]: val })

  const handleExport = () => {
    downloadJson({ reportTheme: theme }, 'report-theme.json')
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result)
        const raw = parsed.reportTheme ?? parsed
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          alert('Invalid theme file — expected an object.')
          return
        }
        onChange({ ...defaultTheme, ...raw })
      } catch {
        alert('Could not parse theme file — invalid JSON.')
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-imported
    e.target.value = ''
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: 'var(--color-surface2)',
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 12 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Chart Theme</span>
        {/* Preview swatches */}
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {(theme.palette ?? []).slice(0, 6).map((c, i) => (
            <span key={i} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c }} />
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={handleExport}
            title="Export theme as JSON"
            style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)' }}
          >
            ↓ Export
          </button>
          <button
            onClick={() => importRef.current?.click()}
            title="Import theme from JSON"
            style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)' }}
          >
            ↑ Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '12px 14px', background: 'var(--color-surface)' }}>
          <PaletteEditor
            colors={theme.palette ?? []}
            onChange={colors => update('palette', colors)}
          />

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '10px 0' }} />

          <ColorRow label="Background" value={theme.bg} onChange={v => update('bg', v)} />

          {/* Background opacity / alpha */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 80, flexShrink: 0 }}>
              Opacity
            </span>
            <input
              type="range"
              min={0} max={100}
              value={theme.bgAlpha ?? 100}
              onChange={e => update('bgAlpha', Number(e.target.value))}
              style={{ flex: 1, maxWidth: 140 }}
            />
            <span style={{ fontSize: 11, fontFamily: 'monospace', width: 36, textAlign: 'right' }}>
              {theme.bgAlpha ?? 100}%
            </span>
            {/* Live preview swatch */}
            <span style={{
              display: 'inline-block', width: 22, height: 22, borderRadius: 3,
              background: theme.bg,
              opacity: (theme.bgAlpha ?? 100) / 100,
              border: '1px solid var(--color-border)',
            }} />
          </div>

          <ColorRow label="Text" value={theme.textColor} onChange={v => update('textColor', v)} />
          <ColorRow label="Grid Lines" value={theme.gridColor} onChange={v => update('gridColor', v)} />
          <ColorRow label="Axis Lines" value={theme.axisColor} onChange={v => update('axisColor', v)} />

          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => onChange({ ...defaultTheme })}
              style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
