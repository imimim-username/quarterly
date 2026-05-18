import React from 'react'

const SOURCE_OPTIONS = ['global_start', 'global_end', 'pagination_first', 'pagination_skip', 'pagination_after', 'user', 'none']
const TYPE_OPTIONS = ['int', 'float', 'string', 'datetime', 'boolean']

/**
 * VariablePanel — table UI for editing variable_defs array.
 */
export default function VariablePanel({ variableDefs, onChange }) {
  const defs = Array.isArray(variableDefs) ? variableDefs : []

  const update = (index, field, value) => {
    const updated = defs.map((d, i) => i === index ? { ...d, [field]: value } : d)
    onChange(updated)
  }

  const addRow = () => {
    onChange([...defs, { name: '', type: 'int', label: '', source: 'user', default: '' }])
  }

  const removeRow = (index) => {
    onChange(defs.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Variable Definitions</span>
        <button onClick={addRow} style={{ fontSize: 11, padding: '2px 8px' }}>+ Add</button>
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Name', 'Type', 'Label', 'Source', 'Default', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {defs.map((def, i) => (
            <tr key={i}>
              <td style={{ padding: '3px 4px' }}>
                <input value={def.name || ''} onChange={e => update(i, 'name', e.target.value)} style={{ width: '100%' }} placeholder="varName" />
              </td>
              <td style={{ padding: '3px 4px' }}>
                <select value={def.type || 'int'} onChange={e => update(i, 'type', e.target.value)} style={{ width: '100%' }}>
                  {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={{ padding: '3px 4px' }}>
                <input value={def.label || ''} onChange={e => update(i, 'label', e.target.value)} style={{ width: '100%' }} placeholder="Label" />
              </td>
              <td style={{ padding: '3px 4px' }}>
                <select value={def.source || 'user'} onChange={e => update(i, 'source', e.target.value)} style={{ width: '100%' }}>
                  {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td style={{ padding: '3px 4px' }}>
                <input value={def.default ?? ''} onChange={e => update(i, 'default', e.target.value)} style={{ width: '100%' }} placeholder="default" />
              </td>
              <td style={{ padding: '3px 4px' }}>
                <button onClick={() => removeRow(i)} style={{ padding: '2px 6px', fontSize: 11 }}>✕</button>
              </td>
            </tr>
          ))}
          {defs.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: '8px 4px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                No variables defined.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
