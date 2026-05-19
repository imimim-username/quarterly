import React, { useState, useRef } from 'react'
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { toPng } from 'html-to-image'

const CHART_TYPES = ['bar', 'line', 'area']
const COLORS = ['#e94560', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#ff5722', '#607d8b']

/**
 * ResultsChart — Recharts wrapper with X/Y field selection and PNG export.
 */
function applyDivisorNumeric(value, divisor) {
  if (!divisor || divisor === 'raw') return Number(value)
  try {
    // Use BigInt for the integer part, then convert to float for charting
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    const intPart = Number(raw / pow)
    const fracPart = Number(raw % pow) / Number(pow)
    return intPart + fracPart
  } catch {
    return Number(value)
  }
}

export default function ResultsChart({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {} }) {
  const [xField, setXField] = useState('')
  const [yFields, setYFields] = useState([])
  const [chartType, setChartType] = useState('bar')
  const chartRef = useRef(null)

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results to chart.</div>
  }

  const columns = Object.keys(rows[0] || {})

  const addYField = (col) => {
    if (col && !yFields.includes(col)) setYFields(prev => [...prev, col])
  }

  const removeYField = (col) => {
    setYFields(prev => prev.filter(f => f !== col))
  }

  const handleExportPng = async () => {
    if (!chartRef.current) return
    try {
      const dataUrl = await toPng(chartRef.current, { backgroundColor: '#1a1a2e' })
      const link = document.createElement('a')
      link.download = 'chart.png'
      link.href = dataUrl
      link.click()
    } catch (e) {
      alert('PNG export failed: ' + e.message)
    }
  }

  const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart
  const SeriesComponent = chartType === 'bar' ? Bar : chartType === 'line' ? Line : Area

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="form-group" style={{ minWidth: 180, margin: 0 }}>
          <label>X Field</label>
          <select value={xField} onChange={e => setXField(e.target.value)}>
            <option value="">Select…</option>
            {columns.map(c => <option key={c} value={c}>{fieldMeta[c]?.label || c}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180, margin: 0 }}>
          <label>Y Fields</label>
          <select
            value=""
            onChange={e => { addYField(e.target.value); e.target.value = '' }}
          >
            <option value="">Add column…</option>
            {columns.filter(c => !yFields.includes(c)).map(c => (
              <option key={c} value={c}>{fieldMeta[c]?.label || c}</option>
            ))}
          </select>
          {yFields.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {yFields.map((col, i) => (
                <span key={col} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 6px', fontSize: 11, borderRadius: 3,
                  background: COLORS[i % COLORS.length],
                  color: '#fff',
                }}>
                  {fieldMeta[col]?.label || col}
                  <button
                    onClick={() => removeYField(col)}
                    style={{
                      background: 'none', border: 'none', color: '#fff',
                      cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1,
                    }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="form-group" style={{ minWidth: 120, margin: 0 }}>
          <label>Chart Type</label>
          <select value={chartType} onChange={e => setChartType(e.target.value)}>
            {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={handleExportPng} style={{ alignSelf: 'flex-end' }}>Export PNG</button>
      </div>

      {xField && yFields.length > 0 && (
        <div ref={chartRef} style={{ background: 'var(--color-bg)', padding: 8, borderRadius: 4 }}>
          <ResponsiveContainer width="100%" height={350}>
            <ChartComponent data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey={xField}
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickFormatter={colDivisors[xField] === 'datetime'
                  ? v => new Date(Number(v) * 1000).toLocaleDateString()
                  : undefined}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 12 }}
                labelFormatter={colDivisors[xField] === 'datetime'
                  ? v => new Date(Number(v) * 1000).toLocaleString()
                  : undefined}
              />
              <Legend />
              {yFields.map((field, i) => {
                const divisor = colDivisors[field]
                const dataKey = divisor && divisor !== 'raw'
                  ? row => applyDivisorNumeric(row[field], divisor)
                  : field
                const label = (fieldMeta[field]?.label || field) +
                  (divisor === '1e18' ? ' (÷1e18)' : divisor === '1e6' ? ' (÷1e6)' : '')
                return (
                  <SeriesComponent
                    key={field}
                    dataKey={dataKey}
                    name={label}
                    fill={COLORS[i % COLORS.length]}
                    stroke={COLORS[i % COLORS.length]}
                  />
                )
              })}
            </ChartComponent>
          </ResponsiveContainer>
        </div>
      )}
      {(!xField || yFields.length === 0) && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Select X and Y fields to render chart.
        </div>
      )}
    </div>
  )
}
