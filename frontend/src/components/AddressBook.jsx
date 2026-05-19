import React, { useState, useEffect } from 'react'
import { listAddressLabels, createAddressLabel, updateAddressLabel, deleteAddressLabel } from '../api/client.js'

const EMPTY_FORM = { address: '', chain: '', name: '', notes: '' }

export default function AddressBook({ onClose, onLabelsChange }) {
  const [labels, setLabels] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listAddressLabels().then(({ data }) => {
      if (data) setLabels(data)
    })
  }, [])

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setError(null) }

  const handleEdit = (label) => {
    setForm({ address: label.address, chain: label.chain, name: label.name, notes: label.notes })
    setEditingId(label.id)
    setError(null)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this label?')) return
    const { ok } = await deleteAddressLabel(id)
    if (ok) {
      const next = labels.filter(l => l.id !== id)
      setLabels(next)
      onLabelsChange?.(next)
      if (editingId === id) resetForm()
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      let result
      if (editingId) {
        result = await updateAddressLabel(editingId, form)
      } else {
        result = await createAddressLabel(form)
      }
      if (!result.ok) {
        setError(result.data?.message || 'Save failed.')
        return
      }
      let next
      if (editingId) {
        next = labels.map(l => l.id === editingId ? result.data : l)
      } else {
        next = [...labels, result.data]
      }
      setLabels(next)
      onLabelsChange?.(next)
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = { fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }

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
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>Address Book</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ fontSize: 12, padding: '3px 10px' }}>Close</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Add / Edit form */}
        <form onSubmit={handleSubmit} style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {editingId ? 'Edit label' : 'Add label'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Address *</label>
              <input
                style={inputStyle}
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="0x…"
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Chain</label>
              <input
                style={inputStyle}
                value={form.chain}
                onChange={e => setForm(f => ({ ...f, chain: e.target.value }))}
                placeholder="arbitrumOne, mainnet… (blank = all chains)"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Name *</label>
              <input
                style={inputStyle}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="USDC, My Vault…"
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Notes</label>
              <input
                style={inputStyle}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>
          </div>
          {error && <div className="error-banner" style={{ padding: '4px 8px', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ fontSize: 12, padding: '3px 12px' }}>
              {saving ? 'Saving…' : editingId ? 'Update' : 'Add'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} style={{ fontSize: 12, padding: '3px 10px', background: 'transparent' }}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {/* Labels table */}
        {labels.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No labels yet. Add one above.</div>
        ) : (
          <div className="results-table-container" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Chain</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {labels.map(label => (
                  <tr key={label.id} style={{ background: editingId === label.id ? 'var(--color-surface2)' : undefined }}>
                    <td>{label.name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{label.address}</td>
                    <td>{label.chain || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>all chains</span>}</td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label.notes}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleEdit(label)}
                        style={{ fontSize: 11, padding: '1px 8px', marginRight: 4, background: 'transparent' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(label.id)}
                        style={{ fontSize: 11, padding: '1px 8px', background: 'transparent', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
