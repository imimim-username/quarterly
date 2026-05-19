import React, { useState, useMemo, useRef, useEffect } from 'react'
import * as echarts from 'echarts'

/**
 * Minimal ECharts React wrapper — no third-party adapter needed.
 * Handles init, option updates, resize, and dispose.
 */
function ECharts({ option, style, notMerge = false }) {
  const containerRef = useRef(null)
  const instanceRef = useRef(null)

  useEffect(() => {
    const chart = echarts.init(containerRef.current, 'dark')
    instanceRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.dispose() }
  }, [])

  useEffect(() => {
    instanceRef.current?.setOption(option, { notMerge })
  }, [option, notMerge])

  return <div ref={containerRef} style={style} />
}

const CHART_TYPES = ['bar', 'line', 'area']
const GROUP_BY_OPTIONS = ['none', 'day', 'week', 'month']
const Y_MODE_OPTIONS = ['raw', 'cumulative']
const COLORS = ['#e94560', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#ff5722', '#607d8b']

function applyDivisorNumeric(value, divisor) {
  if (value === null || value === undefined || value === '') return null
  if (!divisor || divisor === 'raw' || divisor === 'datetime') return Number(value)
  try {
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    return Number(raw / pow) + Number(raw % pow) / Number(pow)
  } catch {
    return Number(value)
  }
}

function bucketTimestamp(ts, groupBy) {
  const d = new Date(Number(ts) * 1000)
  if (groupBy === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
  if (groupBy === 'week') return Math.floor(Number(ts) / 604800) * 604800
  if (groupBy === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  return Number(ts)
}

function buildChartData(rows, xField, yFields, colDivisors, groupBy, yMode) {
  if (!rows || !xField || yFields.length === 0) return []

  let data
  if (groupBy === 'none') {
    data = rows.map(row => {
      const point = { x: row[xField] }
      for (const f of yFields) point[f] = applyDivisorNumeric(row[f], colDivisors[f])
      return point
    })
  } else {
    // Bucket by time period — xField treated as unix seconds
    const map = new Map()
    for (const row of rows) {
      const bucket = bucketTimestamp(row[xField], groupBy)
      if (!map.has(bucket)) {
        map.set(bucket, Object.fromEntries(yFields.map(f => [f, 0])))
      }
      const entry = map.get(bucket)
      for (const f of yFields) {
        const v = applyDivisorNumeric(row[f], colDivisors[f])
        if (v !== null && !isNaN(v)) entry[f] += v
      }
    }
    data = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, vals]) => ({ x: bucket, ...vals }))
  }

  // Cumulative / running sum
  if (yMode === 'cumulative') {
    const running = Object.fromEntries(yFields.map(f => [f, 0]))
    data = data.map(point => {
      const p = { ...point }
      for (const f of yFields) { running[f] += (p[f] ?? 0); p[f] = running[f] }
      return p
    })
  }

  return data
}

/**
 * ResultsChart — ECharts wrapper with X/Y field selection, group-by, and cumulative modes.
 */
export default function ResultsChart({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {} }) {
  const [xField, setXField] = useState('')
  const [yFields, setYFields] = useState([])
  const [chartType, setChartType] = useState('bar')
  const [groupBy, setGroupBy] = useState('none')
  const [yMode, setYMode] = useState('raw')

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results to chart.</div>
  }

  const columns = Object.keys(rows[0] || {})

  const isTimestampX = xField === 'timestamp' || colDivisors[xField] === 'datetime'

  const addYField = (col) => {
    if (col && !yFields.includes(col)) setYFields(prev => [...prev, col])
  }
  const removeYField = (col) => setYFields(prev => prev.filter(f => f !== col))

  const chartData = useMemo(
    () => buildChartData(rows, xField, yFields, colDivisors, groupBy, yMode),
    [rows, xField, yFields, colDivisors, groupBy, yMode]
  )

  const xLabels = useMemo(() => chartData.map(p => {
    if (isTimestampX || groupBy !== 'none') {
      return new Date(Number(p.x) * 1000).toLocaleDateString()
    }
    return String(p.x)
  }), [chartData, isTimestampX, groupBy])

  const option = useMemo(() => {
    if (!xField || yFields.length === 0) return {}
    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: { fontSize: 12 },
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      },
      legend: {
        data: yFields.map((f, i) => ({
          name: seriesLabel(f, fieldMeta, colDivisors),
          itemStyle: { color: COLORS[i % COLORS.length] },
        })),
        textStyle: { color: 'var(--color-text-muted)', fontSize: 11 },
        bottom: 48,
      },
      toolbox: {
        right: 12,
        top: 4,
        feature: {
          saveAsImage: { name: 'chart', title: 'Save PNG' },
          restore: { title: 'Reset' },
          dataZoom: { title: { zoom: 'Zoom', back: 'Reset zoom' } },
        },
      },
      dataZoom: [
        { type: 'slider', bottom: 20, height: 20, borderColor: 'var(--color-border)' },
        { type: 'inside' },
      ],
      grid: { top: 32, left: 60, right: 20, bottom: 90 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { rotate: xLabels.length > 12 ? 30 : 0, fontSize: 11, color: 'var(--color-text-muted)' },
        axisLine: { lineStyle: { color: 'var(--color-border)' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 11, color: 'var(--color-text-muted)' },
        splitLine: { lineStyle: { color: 'var(--color-border)', type: 'dashed' } },
      },
      series: yFields.map((f, i) => ({
        name: seriesLabel(f, fieldMeta, colDivisors),
        type: chartType === 'area' ? 'line' : chartType,
        data: chartData.map(p => p[f] ?? null),
        areaStyle: chartType === 'area' ? { opacity: 0.25 } : undefined,
        smooth: chartType !== 'bar',
        color: COLORS[i % COLORS.length],
        lineStyle: { width: 2 },
        symbol: chartData.length > 100 ? 'none' : 'circle',
        symbolSize: 4,
      })),
    }
  }, [xField, yFields, chartType, chartData, xLabels, colDivisors, fieldMeta])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ minWidth: 160, margin: 0 }}>
          <label>X Field</label>
          <select value={xField} onChange={e => { setXField(e.target.value); setGroupBy('none') }}>
            <option value="">Select…</option>
            {columns.map(c => <option key={c} value={c}>{fieldMeta[c]?.label || c}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ minWidth: 160, margin: 0 }}>
          <label>Y Fields</label>
          <select value="" onChange={e => { addYField(e.target.value); e.target.value = '' }}>
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
                  background: COLORS[i % COLORS.length], color: '#fff',
                }}>
                  {fieldMeta[col]?.label || col}
                  <button
                    onClick={() => removeYField(col)}
                    style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="form-group" style={{ minWidth: 100, margin: 0 }}>
          <label>Chart Type</label>
          <select value={chartType} onChange={e => setChartType(e.target.value)}>
            {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {isTimestampX && (
          <>
            <div className="form-group" style={{ minWidth: 110, margin: 0 }}>
              <label>Group By</label>
              <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                {GROUP_BY_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ minWidth: 120, margin: 0 }}>
              <label>Y Mode</label>
              <select value={yMode} onChange={e => setYMode(e.target.value)}>
                {Y_MODE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Chart */}
      {xField && yFields.length > 0 ? (
        <ECharts option={option} notMerge style={{ height: 420, width: '100%' }} />
      ) : (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Select X and at least one Y field to render chart.
        </div>
      )}
    </div>
  )
}

function seriesLabel(field, fieldMeta, colDivisors) {
  const base = fieldMeta[field]?.label || field
  const d = colDivisors[field]
  if (d === '1e18') return `${base} (÷1e18)`
  if (d === '1e6') return `${base} (÷1e6)`
  return base
}
