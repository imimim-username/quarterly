import React, { useState, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { createQuery, updateQuery, deleteQuery } from '../api/client.js'
import VariablePanel from './VariablePanel.jsx'
import ComputedColumnsEditor from './ComputedColumnsEditor.jsx'

const PAGINATION_STYLES = ['offset', 'cursor', 'none']
const DATE_FORMATS = ['unix_seconds', 'unix_ms', 'iso8601']
const CHAIN_MODES = ['filter', 'variable', 'none']

const DEFAULT_TS_EXTRACTION = {
  sourceField: '',
  delimiter: '/',
  position: 'after',
  outputName: 'parsed_timestamp',
  outputLabel: 'Timestamp',
}

function emptyQuery() {
  return {
    name: '',
    description: '',
    category: 'General',
    gql: '',
    result_path: 'data.',
    pagination_style: 'offset',
    cursor_path: '',
    has_next_path: '',
    date_format: 'unix_seconds',
    chain_mode: 'filter',
    chain_var_name: 'chain',
    chain_field: 'chain',
    key_field: 'id',
    variable_defs: [],
    field_meta: {},
    computed_columns: [],
    timestamp_extraction: null,
    is_builtin: 0,
  }
}

/**
 * QueryEditor — full metadata form with CodeMirror GQL editor.
 * "Run" button calls onRun(query). Save/Delete buttons persist to backend.
 */
export default function QueryEditor({ query, prefillGql, onSave, onDelete, onRun, running }) {
  const [form, setForm] = useState(emptyQuery())
  const [fieldMetaText, setFieldMetaText] = useState('{}')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (query) {
      setForm({
        ...emptyQuery(),
        ...query,
        variable_defs: Array.isArray(query.variable_defs) ? query.variable_defs : [],
        computed_columns: Array.isArray(query.computed_columns) ? query.computed_columns : [],
      })
      setFieldMetaText(
        typeof query.field_meta === 'object'
          ? JSON.stringify(query.field_meta, null, 2)
          : query.field_meta || '{}'
      )
    } else {
      setForm({ ...emptyQuery(), gql: prefillGql || '' })
      setFieldMetaText('{}')
    }
    setError('')
  }, [query, prefillGql])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSave = async () => {
    setError('')
    // Parse field_meta
    let field_meta
    try {
      field_meta = JSON.parse(fieldMetaText)
    } catch (e) {
      setError('field_meta is not valid JSON: ' + e.message)
      return
    }

    const payload = {
      ...form,
      field_meta: JSON.stringify(field_meta),
      variable_defs: JSON.stringify(form.variable_defs),
      computed_columns: JSON.stringify(form.computed_columns || []),
      timestamp_extraction: form.timestamp_extraction
        ? JSON.stringify(form.timestamp_extraction)
        : null,
    }

    setSaving(true)
    try {
      let result
      if (form.id) {
        result = await updateQuery(form.id, payload)
      } else {
        result = await createQuery(payload)
      }
      if (!result.ok) {
        setError(result.data?.message || 'Save failed.')
        return
      }
      onSave && onSave(result.data)
    } catch (e) {
      setError('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!form.id) return
    if (!window.confirm(`Delete query "${form.name}"? This will also delete all run history.`)) return
    try {
      const result = await deleteQuery(form.id)
      if (!result.ok && result.status !== 204) {
        setError(result.data?.message || 'Delete failed.')
        return
      }
      onDelete && onDelete(form.id)
    } catch (e) {
      setError('Delete failed: ' + e.message)
    }
  }

  const handleRun = () => {
    onRun && onRun({ ...form, variable_defs: form.variable_defs, field_meta: JSON.parse(fieldMetaText || '{}') })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflowY: 'auto' }}>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div className="form-group">
          <label>Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Query Name" />
        </div>
        <div className="form-group">
          <label>Category</label>
          <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="General" />
        </div>
        <div className="form-group">
          <label>Key Field</label>
          <input value={form.key_field} onChange={e => set('key_field', e.target.value)} placeholder="id" />
        </div>
      </div>

      <div className="form-group">
        <label>Description</label>
        <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
        <div className="form-group">
          <label>Result Path *</label>
          <input value={form.result_path} onChange={e => set('result_path', e.target.value)} placeholder="data.deposits" />
        </div>
        <div className="form-group">
          <label>Pagination Style</label>
          <select value={form.pagination_style} onChange={e => set('pagination_style', e.target.value)}>
            {PAGINATION_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Date Format</label>
          <select value={form.date_format} onChange={e => set('date_format', e.target.value)}>
            {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Chain Mode</label>
          <select value={form.chain_mode} onChange={e => set('chain_mode', e.target.value)}>
            {CHAIN_MODES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {form.pagination_style === 'cursor' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>Cursor Path</label>
            <input value={form.cursor_path} onChange={e => set('cursor_path', e.target.value)} placeholder="data.items.pageInfo.endCursor" />
          </div>
          <div className="form-group">
            <label>Has Next Path</label>
            <input value={form.has_next_path} onChange={e => set('has_next_path', e.target.value)} placeholder="data.items.pageInfo.hasNextPage" />
          </div>
        </div>
      )}

      <div className="form-group">
        <label>GraphQL Query</label>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, minHeight: 200 }}>
          <CodeMirror
            value={form.gql}
            extensions={[javascript()]}
            onChange={val => set('gql', val)}
            theme="dark"
            basicSetup={{ lineNumbers: true, foldGutter: false }}
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      <VariablePanel
        variableDefs={form.variable_defs}
        onChange={defs => set('variable_defs', defs)}
      />

      <div className="form-group">
        <label>Field Metadata (JSON)</label>
        <textarea
          value={fieldMetaText}
          onChange={e => setFieldMetaText(e.target.value)}
          rows={6}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical' }}
          placeholder='{"fieldName": {"label": "Label", "decimals": 18}}'
        />
      </div>

      <div className="form-group">
        <label>Computed Columns</label>
        <ComputedColumnsEditor
          defs={form.computed_columns || []}
          onChange={defs => set('computed_columns', defs)}
        />
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!!form.timestamp_extraction}
            onChange={e => set('timestamp_extraction', e.target.checked ? { ...DEFAULT_TS_EXTRACTION } : null)}
          />
          Parse Timestamp from Field
        </label>
        {form.timestamp_extraction && (
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.8fr 1fr 1fr', gap: 8 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Source Field</label>
              <input
                value={form.timestamp_extraction.sourceField}
                onChange={e => set('timestamp_extraction', { ...form.timestamp_extraction, sourceField: e.target.value })}
                placeholder="id"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Delimiter</label>
              <input
                value={form.timestamp_extraction.delimiter}
                onChange={e => set('timestamp_extraction', { ...form.timestamp_extraction, delimiter: e.target.value })}
                placeholder="/"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Position</label>
              <select
                value={form.timestamp_extraction.position}
                onChange={e => set('timestamp_extraction', { ...form.timestamp_extraction, position: e.target.value })}
              >
                <option value="after">After</option>
                <option value="before">Before</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Output Field Name</label>
              <input
                value={form.timestamp_extraction.outputName}
                onChange={e => set('timestamp_extraction', { ...form.timestamp_extraction, outputName: e.target.value })}
                placeholder="parsed_timestamp"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Output Label</label>
              <input
                value={form.timestamp_extraction.outputLabel}
                onChange={e => set('timestamp_extraction', { ...form.timestamp_extraction, outputLabel: e.target.value })}
                placeholder="Timestamp"
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingBottom: 16 }}>
        <button onClick={handleRun} disabled={running || !query?.id || !form.gql || !form.result_path} style={{ background: 'var(--color-accent)', border: 'none' }}>
          {running ? <><span className="spinner" style={{ marginRight: 6 }} />Running…</> : '▶ Run'}
        </button>
        <button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : (form.id ? 'Save' : 'Create')}
        </button>
        {form.id && (
          <button onClick={handleDelete} style={{ marginLeft: 'auto', background: 'transparent', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
