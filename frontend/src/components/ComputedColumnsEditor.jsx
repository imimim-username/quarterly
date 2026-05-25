import React, { useState } from 'react'
import { parseFormula } from '../utils/computedColumns.js'

const EMPTY_DEF = { name: '', label: '', formula: '' }

/**
 * ComputedColumnsEditor
 *
 * Lets users define virtual columns via formula strings.
 * Each column has:
 *   name    — identifier (must be a valid JS variable name, no spaces)
 *   label   — display label shown in the table / chart
 *   formula — arithmetic expression (e.g. "volume / price")
 *
 * Props:
 *   defs       {object[]}  — current array of computed column definitions
 *   onChange   {function}  — called with the new definitions array
 *   columnNames {string[]} — available column names from query results (for hint)
 */
export default function ComputedColumnsEditor({ defs = [], onChange, columnNames = [] }) {
  const [editIndex, setEditIndex] = useState(null)
  const [form, setForm] = useState(EMPTY_DEF)
  const [error, setError] = useState('')

  const validate = ({ name, formula }) => {
    if (!name.trim()) return 'Column name is required.'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) {
      return 'Name must start with a letter or underscore and contain only letters, digits, or underscores.'
    }
    if (!formula.trim()) return 'Formula is required.'
    if (!parseFormula(formula.trim())) return 'Formula is invalid — check syntax.'
    return ''
  }

  const startAdd = () => {
    setEditIndex('new')
    setForm(EMPTY_DEF)
    setError('')
  }

  const startEdit = (i) => {
    setEditIndex(i)
    setForm({ ...defs[i] })
    setError('')
  }

  const cancel = () => {
    setEditIndex(null)
    setForm(EMPTY_DEF)
    setError('')
  }

  const save = () => {
    const err = validate(form)
    if (err) { setError(err); return }

    const def = { name: form.name.trim(), label: form.label.trim() || form.name.trim(), formula: form.formula.trim() }

    if (editIndex === 'new') {
      // Prevent duplicate names
      if (defs.some(d => d.name === def.name)) {
        setError(`A column named "${def.name}" already exists.`)
        return
      }
      onChange([...defs, def])
    } else {
      const updated = defs.map((d, i) => (i === editIndex ? def : d))
      onChange(updated)
    }

    cancel()
  }

  const remove = (i) => {
    onChange(defs.filter((_, idx) => idx !== i))
    if (editIndex === i) cancel()
  }

  const moveUp = (i) => {
    if (i === 0) return
    const copy = [...defs]
    ;[copy[i - 1], copy[i]] = [copy[i], copy[i - 1]]
    onChange(copy)
    if (editIndex === i) setEditIndex(i - 1)
    else if (editIndex === i - 1) setEditIndex(i)
  }

  const moveDown = (i) => {
    if (i === defs.length - 1) return
    const copy = [...defs]
    ;[copy[i], copy[i + 1]] = [copy[i + 1], copy[i]]
    onChange(copy)
    if (editIndex === i) setEditIndex(i + 1)
    else if (editIndex === i + 1) setEditIndex(i)
  }

  const formulaValid = form.formula.trim() ? !!parseFormula(form.formula) : true
  const availableVars = [...columnNames, ...defs.filter((_, i) => i !== editIndex).map(d => d.name)]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Define virtual columns using arithmetic formulas. Variables are the column names from your
        query results, evaluated after divisors are applied.
        Columns are evaluated in order — later columns can reference earlier ones.
      </p>

      {/* Existing definitions list */}
      {defs.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: '3px 8px', fontWeight: 600 }}>Name</th>
              <th style={{ textAlign: 'left', padding: '3px 8px', fontWeight: 600 }}>Label</th>
              <th style={{ textAlign: 'left', padding: '3px 8px', fontWeight: 600 }}>Formula</th>
              <th style={{ padding: '3px 4px' }}></th>
            </tr>
          </thead>
          <tbody>
            {defs.map((def, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: editIndex === i ? 'rgba(255,255,255,0.03)' : 'transparent',
                }}
              >
                <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{def.name}</td>
                <td style={{ padding: '4px 8px' }}>{def.label}</td>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: 'var(--color-accent)' }}>{def.formula}</td>
                <td style={{ padding: '4px 4px', whiteSpace: 'nowrap', display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    style={{ fontSize: 11, padding: '1px 5px', opacity: i === 0 ? 0.4 : 1 }}
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i === defs.length - 1}
                    style={{ fontSize: 11, padding: '1px 5px', opacity: i === defs.length - 1 ? 0.4 : 1 }}
                    title="Move down"
                  >↓</button>
                  <button
                    onClick={() => startEdit(i)}
                    style={{ fontSize: 11, padding: '1px 6px' }}
                  >Edit</button>
                  <button
                    onClick={() => remove(i)}
                    style={{ fontSize: 11, padding: '1px 6px', color: 'var(--color-error)', borderColor: 'var(--color-error)', background: 'transparent' }}
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {defs.length === 0 && editIndex === null && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No computed columns defined yet.</div>
      )}

      {/* Form */}
      {editIndex !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {editIndex === 'new' ? 'Add column' : 'Edit column'}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
              <label style={{ fontSize: 11 }}>Name <span style={{ color: 'var(--color-text-muted)' }}>(identifier)</span></label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. price_ratio"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                disabled={editIndex !== 'new'}
              />
            </div>

            <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
              <label style={{ fontSize: 11 }}>Label <span style={{ color: 'var(--color-text-muted)' }}>(display)</span></label>
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Price Ratio"
                style={{ fontSize: 12 }}
              />
            </div>

            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11 }}>
                Formula
                {form.formula.trim() && (
                  <span style={{ marginLeft: 6, color: formulaValid ? 'var(--color-success, #4caf50)' : 'var(--color-error)' }}>
                    {formulaValid ? '✓ valid' : '✗ invalid'}
                  </span>
                )}
              </label>
              <input
                value={form.formula}
                onChange={e => setForm(f => ({ ...f, formula: e.target.value }))}
                placeholder="e.g. volume / price"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
          </div>

          {/* Available variable hint */}
          {availableVars.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Available variables: {availableVars.map(v => (
                <code
                  key={v}
                  onClick={() => setForm(f => ({ ...f, formula: f.formula + (f.formula && !f.formula.endsWith(' ') ? ' ' : '') + v }))}
                  style={{ cursor: 'pointer', marginRight: 4, padding: '0 2px', borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}
                  title={`Click to insert "${v}"`}
                >{v}</code>
              ))}
            </div>
          )}

          {error && (
            <div className="error-banner" style={{ fontSize: 12, padding: '4px 8px' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={{ fontSize: 12, padding: '3px 12px' }}>
              {editIndex === 'new' ? 'Add' : 'Save'}
            </button>
            <button onClick={cancel} style={{ fontSize: 12, padding: '3px 10px', background: 'transparent' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {editIndex === null && (
        <div>
          <button onClick={startAdd} style={{ fontSize: 12, padding: '3px 12px' }}>
            + Add column
          </button>
        </div>
      )}
    </div>
  )
}
