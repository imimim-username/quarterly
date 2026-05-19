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

function buildChartData(rows, xField, allYFields, colDivisors, groupBy, yMode) {
  if (!rows || !xField || allYFields.length === 0) return []

  let data
  if (groupBy === 'none') {
    data = rows.map(row => {
      const point = { x: row[xField] }
      for (const f of allYFields) point[f] = applyDivisorNumeric(row[f], colDivisors[f])
      return point
    })
  } else {
    const map = new Map()
    for (const row of rows) {
      const bucket = bucketTimestamp(row[xField], groupBy)
      if (!map.has(bucket)) {
        map.set(bucket, Object.fromEntries(allYFields.map(f => [f, 0])))
      }
      const entry = map.get(bucket)
      for (const f of allYFields) {
        const v = applyDivisorNumeric(row[f], colDivisors[f])
        if (v !== null && !isNaN(v)) entry[f] += v
      }
    }
    data = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, vals]) => ({ x: bucket, ...vals }))
  }

  if (yMode === 'cumulative') {
    const running = Object.fromEntries(allYFields.map(f => [f, 0]))
    data = data.map(point => {
      const p = { ...point }
      for (const f of allYFields) { running[f] += (p[f] ?? 0); p[f] = running[f] }
      return p
    })
  }

  return data
}

function seriesLabel(field, fieldMeta, colDivisors) {
  const base = fieldMeta[field]?.label || field
  const d = colDivisors[field]
  if (d === '1e18') return `${base} (÷1e18)`
  if (d === '1e6') return `${base} (÷1e6)`
  return base
}

function makeSeries(fields, colorOffset, yAxisIndex, seriesType, chartData, fieldMeta, colDivisors) {
  return fields.map((f, i) => {
    const ci = (colorOffset + i) % COLORS.length
    return {
      name: seriesLabel(f, fieldMeta, colDivisors),
      type: seriesType === 'area' ? 'line' : seriesType,
      yAxisIndex,
      data: chartData.map(p => p[f] ?? null),
      areaStyle: seriesType === 'area' ? { opacity: 0.25 } : undefined,
      smooth: seriesType !== 'bar',
      color: COLORS[ci],
      lineStyle: { width: 2 },
      symbol: chartData.length > 100 ? 'none' : 'circle',
      symbolSize: 4,
    }
  })
}

function YAxisSelector({ label, fields, setFields, allFields, usedByOther, colorOffset, fieldMeta, seriesType, setSeriesType }) {
  const available = allFields.filter(c => !fields.includes(c) && !usedByOther.includes(c))

  const add = (col) => { if (col) setFields(prev => [...prev, col]) }
  const remove = (col) => setFields(prev => prev.filter(f => f !== col))

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        <select
          value={seriesType}
          onChange={e => setSeriesType(e.target.value)}
          style={{ fontSize: 11, padding: '1px 4px', marginLeft: 4 }}
        >
          {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <select value="" onChange={e => { add(e.target.value); e.target.value = '' }}>
        <option value="">Add column…</option>
        {available.map(c => (
          <option key={c} value={c}>{fieldMeta[c]?.label || c}</option>
        ))}
      </select>
      {fields.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {fields.map((col, i) => {
            const ci = (colorOffset + i) % COLORS.length
            return (
              <span key={col} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px', fontSize: 11, borderRadius: 3,
                background: COLORS[ci], color: '#fff',
              }}>
                {fieldMeta[col]?.label || col}
                <button
                  onClick={() => remove(col)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                >×</button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * ResultsChart — ECharts dual-axis combo chart with group-by and cumulative transforms.
 */
export default function ResultsChart({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {} }) {
  const [xField, setXField] = useState('')
  const [leftFields, setLeftFields] = useState([])
  const [rightFields, setRightFields] = useState([])
  const [leftType, setLeftType] = useState('bar')
  const [rightType, setRightType] = useState('line')
  const [groupBy, setGroupBy] = useState('none')
  const [yMode, setYMode] = useState('raw')

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results to chart.</div>
  }

  const columns = Object.keys(rows[0] || {})
  const isTimestampX = xField === 'timestamp' || colDivisors[xField] === 'datetime'
  const allYFields = [...leftFields, ...rightFields]
  const hasChart = xField && allYFields.length > 0

  const chartData = useMemo(
    () => buildChartData(rows, xField, allYFields, colDivisors, groupBy, yMode),
    [rows, xField, JSON.stringify(allYFields), colDivisors, groupBy, yMode]
  )

  const xLabels = useMemo(() => chartData.map(p => {
    if (isTimestampX || groupBy !== 'none') {
      return new Date(Number(p.x) * 1000).toLocaleDateString()
    }
    return String(p.x)
  }), [chartData, isTimestampX, groupBy])

  const hasRightAxis = rightFields.length > 0

  const option = useMemo(() => {
    if (!hasChart) return {}

    const allSeries = [
      ...makeSeries(leftFields, 0, 0, leftType, chartData, fieldMeta, colDivisors),
      ...makeSeries(rightFields, leftFields.length, 1, rightType, chartData, fieldMeta, colDivisors),
    ]

    const axisDefaults = {
      type: 'value',
      axisLabel: { fontSize: 11, color: 'var(--color-text-muted)' },
      splitLine: { lineStyle: { color: 'var(--color-border)', type: 'dashed' } },
    }

    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: { fontSize: 12 },
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      },
      legend: {
        data: allSeries.map(s => s.name),
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
      grid: { top: 32, left: 60, right: hasRightAxis ? 60 : 20, bottom: 90 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { rotate: xLabels.length > 12 ? 30 : 0, fontSize: 11, color: 'var(--color-text-muted)' },
        axisLine: { lineStyle: { color: 'var(--color-border)' } },
        splitLine: { show: false },
      },
      yAxis: [
        { ...axisDefaults, position: 'left' },
        { ...axisDefaults, position: 'right', show: hasRightAxis, splitLine: { show: false } },
      ],
      series: allSeries,
    }
  }, [hasChart, leftFields, rightFields, leftType, rightType, chartData, xLabels, colDivisors, fieldMeta, hasRightAxis])

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

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />

        <YAxisSelector
          label="Left Y axis"
          fields={leftFields}
          setFields={setLeftFields}
          allFields={columns}
          usedByOther={rightFields}
          colorOffset={0}
          fieldMeta={fieldMeta}
          seriesType={leftType}
          setSeriesType={setLeftType}
        />

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />

        <YAxisSelector
          label="Right Y axis"
          fields={rightFields}
          setFields={setRightFields}
          allFields={columns}
          usedByOther={leftFields}
          colorOffset={leftFields.length}
          fieldMeta={fieldMeta}
          seriesType={rightType}
          setSeriesType={setRightType}
        />

        {isTimestampX && (
          <>
            <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />
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
      {hasChart ? (
        <ECharts option={option} notMerge style={{ height: 420, width: '100%' }} />
      ) : (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Select X and at least one Y field to render chart.
        </div>
      )}
    </div>
  )
}
