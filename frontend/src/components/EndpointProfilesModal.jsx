import React, { useState, useEffect } from 'react'
import { listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint } from '../api/client.js'

export default function EndpointProfilesModal({ onClose, onSelect }) {
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null) // profile id or 'new'
  const [form, setForm] = useState({ name: '', url: '', is_default: false })
  const [headerRows, setHeaderRows] = useState([]) // [{ key, value }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listEndpoints().then(({ data }) => {
      if (data) setProfiles(data)
    })
  }, [])

  const loadProfile = (profile) => {
    setSelected(profile.id)
    setForm({ name: profile.name, url: profile.url || '', is_default: !!profile.is_default })
    const rows = profile.headers
      ? Object.entries(profile.headers).map(([key, value]) => ({ key, value }))
      : []
    setHeaderRows(rows)
    setError('')
  }

  const startNew = () => {
    setSelected('new')
    setForm({ name: '', url: '', is_default: false })
    setHeaderRows([])
    setError('')
  }

  const clearSelection = () => {
    setSelected(null)
    setForm({ name: '', url: '', is_default: false })
    setHeaderRows([])
    setError('')
  }

  const refreshProfiles = async () => {
    const { data } = await listEndpoints()
    if (data) setProfiles(data)
    return data || []
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const headers = {}
      for (const row of headerRows) {
        if (row.key.trim()) headers[row.key.trim()] = row.value
      }
      const body = { name: form.name, url: form.url, is_default: form.is_default, headers }
      let result
      if (selected === 'new') {
        result = await createEndpoint(body)
      } else {
        result = await updateEndpoint(selected, body)
      }
      if (!result.ok) {
        setError(result.data?.message || 'Save failed.')
        return
      }
      const savedId = result.data?.id ?? selected
      const fresh = await refreshProfiles()
      const savedProfile = fresh.find(p => p.id === savedId)
      if (savedProfile) loadProfile(savedProfile)
      else setSelected(savedId)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this endpoint profile?')) return
    const { ok } = await deleteEndpoint(selected)
    if (ok) {
      await refreshProfiles()
      clearSelection()
    }
  }

  const addHeaderRow = () => setHeaderRows(rows => [...rows, { key: '', value: '' }])

  const updateHeaderRow = (idx, field, val) => {
    setHeaderRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  const removeHeaderRow = (idx) => {
    setHeaderRows(rows => rows.filter((_, i) => i !== idx))
  }

  const inputStyle = {
    fontSize: 12,
    padding: '3px 6px',
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--color-surface2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 3,
  }

  const selectedProfile = profiles.find(p => p.id === selected)

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
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>Endpoint Profiles</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ fontSize: 12, padding: '3px 10px' }}>Close</button>
      </div>

      {/* Body: two columns */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left column: profile list */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
            <button
              onClick={startNew}
              style={{ fontSize: 12, padding: '4px 12px', width: '100%' }}
            >
              + New Profile
            </button>
          </div>
          {profiles.length === 0 && (
            <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>
              No profiles yet.
            </div>
          )}
          {profiles.map(profile => (
            <div
              key={profile.id}
              onClick={() => loadProfile(profile)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: selected === profile.id ? 'var(--color-surface2)' : undefined,
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text)' }}>
                    {profile.name}
                  </span>
                  {profile.is_default && (
                    <span style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'var(--color-success)',
                      color: '#fff',
                      fontWeight: 600,
                    }}>
                      default
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                }}>
                  {profile.url || <em>no url</em>}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onSelect(profile); onClose() }}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  flexShrink: 0,
                  background: 'transparent',
                  borderColor: 'var(--color-accent)',
                  color: 'var(--color-accent)',
                }}
              >
                Use →
              </button>
            </div>
          ))}
        </div>

        {/* Right column: form */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {selected === null ? (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 13,
            }}>
              Select a profile to edit, or create a new one.
            </div>
          ) : (
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>
                {selected === 'new' ? 'New Profile' : (selectedProfile?.name || 'Edit Profile')}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 12 }}>Name *</label>
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My Ponder Node"
                  required
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 12 }}>URL</label>
                <input
                  style={inputStyle}
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://your-ponder-endpoint.com/"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="ep-is-default"
                  checked={form.is_default}
                  onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                  style={{ margin: 0 }}
                />
                <label htmlFor="ep-is-default" style={{ fontSize: 12, cursor: 'pointer', margin: 0 }}>
                  Set as default
                </label>
              </div>

              {/* Auth Headers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>Request Headers</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Sent with every query (e.g. Authorization: Bearer token)
                  </div>
                </div>
                {headerRows.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      style={{ ...inputStyle, width: '40%' }}
                      value={row.key}
                      onChange={e => updateHeaderRow(idx, 'key', e.target.value)}
                      placeholder="Key"
                    />
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      value={row.value}
                      onChange={e => updateHeaderRow(idx, 'value', e.target.value)}
                      placeholder="Value"
                    />
                    <button
                      type="button"
                      onClick={() => removeHeaderRow(idx)}
                      style={{
                        fontSize: 12,
                        padding: '2px 7px',
                        flexShrink: 0,
                        background: 'transparent',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-muted)',
                      }}
                      title="Remove header"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    onClick={addHeaderRow}
                    style={{ fontSize: 12, padding: '3px 10px', background: 'transparent' }}
                  >
                    + Add Header
                  </button>
                </div>
              </div>

              {error && (
                <div className="error-banner" style={{ padding: '4px 8px', fontSize: 12 }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ fontSize: 12, padding: '4px 14px' }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {selected !== 'new' && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    style={{
                      fontSize: 12,
                      padding: '4px 14px',
                      background: 'transparent',
                      borderColor: 'var(--color-error)',
                      color: 'var(--color-error)',
                    }}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{ fontSize: 12, padding: '4px 10px', background: 'transparent' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
