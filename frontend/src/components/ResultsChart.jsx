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

/** Compact axis tick formatter: 1,500,000 → "1.5M" */
function fmtAxisVal(val) {
  const abs = Math.abs(val)
  if (abs >= 1e12) return `${+(val / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${+(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${+(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${+(val / 1e3).toFixed(2)}K`
  return String(val)
}

const CHART_TYPES = ['bar', 'line', 'area']
const GROUP_BY_OPTIONS = ['none', 'day', 'week', 'month']
const Y_MODE_OPTIONS = ['raw', 'cumulative']
const AGGREGATION_OPTIONS = ['sum', 'avg', 'median', 'min', 'max', 'count']
const COLORS = ['#e94560', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#ff5722', '#607d8b']
const DIVISOR_CYCLE = ['raw', '1e6', '1e18']
const DIVISOR_LABELS = { raw: 'raw', '1e6': '÷1e6', '1e18': '÷1e18' }

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

/** Collapse an array of numbers into a single value using the chosen method. */
function aggregate(values, method) {
  const nums = values.filter(v => v !== null && !isNaN(v))
  if (nums.length === 0) return null
  switch (method) {
    case 'avg':    return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
    case 'min':   return Math.min(...nums)
    case 'max':   return Math.max(...nums)
    case 'count': return nums.length
    case 'sum':
    default:      return nums.reduce((a, b) => a + b, 0)
  }
}

function buildChartData(rows, xField, allYFields, colDivisors, groupBy, yMode, aggregation = 'sum', xSortDir = 'asc') {
  if (!rows || !xField || allYFields.length === 0) return []

  // Determine the bucket key for each row. When groupBy='none' the key is the
  // raw x value (so duplicate x values are merged); otherwise it is time-normalised.
  const bucketKey = groupBy === 'none'
    ? row => row[xField]
    : row => bucketTimestamp(row[xField], groupBy)

  const map = new Map()
  for (const row of rows) {
    const key = bucketKey(row)
    if (!map.has(key)) map.set(key, Object.fromEntries(allYFields.map(f => [f, []])))
    const entry = map.get(key)
    for (const f of allYFields) {
      const v = applyDivisorNumeric(row[f], colDivisors[f])
      if (v !== null && !isNaN(v)) entry[f].push(v)
    }
  }

  let data = [...map.entries()].map(([key, arrays]) => {
    const point = { x: key }
    for (const f of allYFields) point[f] = aggregate(arrays[f], aggregation)
    return point
  })

  // Sort by x value; numeric when possible, lexicographic otherwise
  data.sort((a, b) => {
    const an = Number(a.x), bn = Number(b.x)
    if (!isNaN(an) && !isNaN(bn)) return an - bn
    return String(a.x).localeCompare(String(b.x))
  })
  if (xSortDir === 'desc') data.reverse()

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

function seriesLabel(field, fieldMeta) {
  return fieldMeta[field]?.label || field
}

function axisName(fields, fieldMeta) {
  return fields.map(f => fieldMeta[f]?.label || f).join(', ')
}

function makeSeries(fields, colorOffset, yAxisIndex, seriesType, chartData, fieldMeta) {
  return fields.map((f, i) => {
    const ci = (colorOffset + i) % COLORS.length
    return {
      name: seriesLabel(f, fieldMeta),
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

function YAxisSelector({ label, fields, setFields, allFields, colorOffset, fieldMeta, seriesType, setSeriesType, yMode, setYMode, showYMode, aggregation, setAggregation, showAggregation, colDivisors, onDivisorChange }) {
  const available = allFields.filter(c => !fields.includes(c))

  const add = (col) => { if (col) setFields(prev => [...prev, col]) }
  const remove = (col) => setFields(prev => prev.filter(f => f !== col))

  const cycleDivisor = (col, e) => {
    e.stopPropagation()
    const cur = colDivisors?.[col] || 'raw'
    const next = DIVISOR_CYCLE[(DIVISOR_CYCLE.indexOf(cur) + 1) % DIVISOR_CYCLE.length]
    onDivisorChange?.({ ...(colDivisors || {}), [col]: next })
  }

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {label}
        <select
          value={seriesType}
          onChange={e => setSeriesType(e.target.value)}
          style={{ fontSize: 11, padding: '1px 4px' }}
        >
          {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {showYMode && (
          <select
            value={yMode}
            onChange={e => setYMode(e.target.value)}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {Y_MODE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {showAggregation && (
          <select
            value={aggregation}
            onChange={e => setAggregation(e.target.value)}
            style={{ fontSize: 11, padding: '1px 4px' }}
            title="Aggregation method for grouped values"
          >
            {AGGREGATION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
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
            const divisor = colDivisors?.[col] || 'raw'
            return (
              <span key={col} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px', fontSize: 11, borderRadius: 3,
                background: COLORS[ci], color: '#fff',
              }}>
                {fieldMeta[col]?.label || col}
                <button
                  onClick={e => cycleDivisor(col, e)}
                  title="Cycle display divisor: raw → ÷1e6 → ÷1e18"
                  style={{
                    background: 'none', border: 'none', color: '#fff',
                    cursor: 'pointer', padding: '0 2px', fontSize: 9, lineHeight: 1,
                    opacity: divisor === 'raw' ? 0.55 : 1,
                  }}
                >
                  {DIVISOR_LABELS[divisor]}
                </button>
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
export default function ResultsChart({ rows, fieldMeta = {}, keyField = 'id', colDivisors = {}, onDivisorChange, chartViews = [], onSaveView }) {
  const [xField, setXField] = useState('')
  const [leftFields, setLeftFields] = useState([])
  const [rightFields, setRightFields] = useState([])
  const [leftType, setLeftType] = useState('bar')
  const [rightType, setRightType] = useState('line')
  const [groupBy, setGroupBy] = useState('none')
  const [leftYMode, setLeftYMode] = useState('raw')
  const [rightYMode, setRightYMode] = useState('raw')
  const [leftAggregation, setLeftAggregation] = useState('sum')
  const [rightAggregation, setRightAggregation] = useState('sum')
  const [xSortDir, setXSortDir] = useState('asc')
  const [showLegend, setShowLegend] = useState(true)
  const [savingView, setSavingView] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [saveError, setSaveError] = useState('')

  const loadView = (view) => {
    if (!view) return
    setXField(view.xField || '')
    setLeftFields(view.leftFields || [])
    setRightFields(view.rightFields || [])
    setLeftType(view.leftType || 'bar')
    setRightType(view.rightType || 'line')
    setGroupBy(view.groupBy || 'none')
    setLeftYMode(view.leftYMode || 'raw')
    setRightYMode(view.rightYMode || 'raw')
    setLeftAggregation(view.leftAggregation || 'sum')
    setRightAggregation(view.rightAggregation || 'sum')
    setXSortDir(view.xSortDir || 'asc')
    setShowLegend(view.showLegend !== false)
    if (view.colDivisors) onDivisorChange?.(view.colDivisors)
  }

  const handleSaveView = async () => {
    const name = window.prompt('View name:')
    if (!name || !name.trim()) return
    setSavingView(true)
    setSaveError('')
    try {
      const view = {
        name: name.trim(),
        xField,
        leftFields,
        rightFields,
        leftType,
        rightType,
        groupBy,
        leftYMode,
        rightYMode,
        leftAggregation,
        rightAggregation,
        xSortDir,
        showLegend,
        colDivisors,
      }
      const ok = await onSaveView?.(view)
      if (ok !== false) {
        setSavedMsg(`✓ Saved "${name.trim()}"`)
        setTimeout(() => setSavedMsg(''), 2500)
      } else {
        setSaveError('Save failed — is the query saved and the server running?')
      }
    } finally {
      setSavingView(false)
    }
  }

  // Derive these before any early return so hook count stays constant
  const columns = Object.keys(rows?.[0] || {})
  const isTimestampX = xField === 'timestamp' || colDivisors[xField] === 'datetime'
  const hasChart = xField && (leftFields.length > 0 || rightFields.length > 0)

  const leftChartData = useMemo(
    () => buildChartData(rows, xField, leftFields, colDivisors, groupBy, leftYMode, leftAggregation, xSortDir),
    [rows, xField, JSON.stringify(leftFields), colDivisors, groupBy, leftYMode, leftAggregation, xSortDir]
  )

  const rightChartData = useMemo(
    () => buildChartData(rows, xField, rightFields, colDivisors, groupBy, rightYMode, rightAggregation, xSortDir),
    [rows, xField, JSON.stringify(rightFields), colDivisors, groupBy, rightYMode, rightAggregation, xSortDir]
  )

  // Use whichever dataset is available for x-axis labels
  const refData = leftChartData.length > 0 ? leftChartData : rightChartData

  const xLabels = useMemo(() => refData.map(p => {
    if (isTimestampX || groupBy !== 'none') {
      const d = new Date(Number(p.x) * 1000)
      // "Jan 5" for day/none, "Jan 2025" for month, "Wk Jan 5" for week
      if (groupBy === 'month') {
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    }
    return String(p.x)
  }), [refData, isTimestampX, groupBy])

  const hasRightAxis = rightFields.length > 0

  // Must be before the early return — hook count must be constant across renders
  const option = useMemo(() => {
    if (!hasChart) return {}

    const allSeries = [
      ...makeSeries(leftFields, 0, 0, leftType, leftChartData, fieldMeta),
      ...makeSeries(rightFields, leftFields.length, 1, rightType, rightChartData, fieldMeta),
    ]

    const leftName = axisName(leftFields, fieldMeta)
    const rightName = axisName(rightFields, fieldMeta)

    const axisLabelStyle = { fontSize: 11, formatter: fmtAxisVal }
    const axisNameStyle = { fontSize: 11, padding: 8 }

    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: { fontSize: 12 },
      },
      legend: {
        show: showLegend,
        data: allSeries.map(s => s.name),
        textStyle: { fontSize: 11 },
        top: 4,
      },
      toolbox: {
        right: 12,
        top: 4,
        feature: {
          saveAsImage: { name: 'chart', title: 'Save PNG', excludeComponents: ['toolbox', 'dataZoom'] },
          restore: { title: 'Reset' },
          dataZoom: { title: { zoom: 'Zoom', back: 'Reset zoom' } },
        },
      },
      dataZoom: [
        { type: 'slider', bottom: 20, height: 20 },
        { type: 'inside' },
      ],
      grid: { top: 56, left: hasRightAxis ? 70 : 60, right: hasRightAxis ? 70 : 20, bottom: 80 },
      xAxis: {
        type: 'category',
        data: xLabels,
        name: fieldMeta[xField]?.label || xField,
        nameLocation: 'middle',
        nameGap: xLabels.length > 12 ? 50 : 36,
        nameTextStyle: axisNameStyle,
        axisLabel: { rotate: xLabels.length > 12 ? 30 : 0, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          name: leftName,
          nameLocation: 'middle',
          nameGap: 50,
          nameRotate: 90,
          nameTextStyle: axisNameStyle,
          axisLabel: axisLabelStyle,
          splitLine: { lineStyle: { type: 'dashed' } },
        },
        {
          type: 'value',
          position: 'right',
          show: hasRightAxis,
          name: rightName,
          nameLocation: 'middle',
          nameGap: 50,
          nameRotate: -90,
          nameTextStyle: axisNameStyle,
          axisLabel: axisLabelStyle,
          splitLine: { show: false },
        },
      ],
      series: allSeries,
    }
  }, [hasChart, xField, leftFields, rightFields, leftType, rightType, leftChartData, rightChartData, xLabels, fieldMeta, hasRightAxis, showLegend])

  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', padding: 16 }}>No results to chart.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>

        <div className="form-group" style={{ minWidth: 160, margin: 0 }}>
          <label>X Field</label>
          <select value={xField} onChange={e => { setXField(e.target.value); setGroupBy('none'); setXSortDir('asc') }}>
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
          colorOffset={0}
          fieldMeta={fieldMeta}
          seriesType={leftType}
          setSeriesType={setLeftType}
          yMode={leftYMode}
          setYMode={setLeftYMode}
          showYMode={isTimestampX}
          aggregation={leftAggregation}
          setAggregation={setLeftAggregation}
          showAggregation={isTimestampX}
          colDivisors={colDivisors}
          onDivisorChange={onDivisorChange}
        />

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />

        <YAxisSelector
          label="Right Y axis"
          fields={rightFields}
          setFields={setRightFields}
          allFields={columns}
          colorOffset={leftFields.length}
          fieldMeta={fieldMeta}
          seriesType={rightType}
          setSeriesType={setRightType}
          yMode={rightYMode}
          setYMode={setRightYMode}
          showYMode={isTimestampX}
          aggregation={rightAggregation}
          setAggregation={setRightAggregation}
          showAggregation={isTimestampX}
          colDivisors={colDivisors}
          onDivisorChange={onDivisorChange}
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
            <div className="form-group" style={{ margin: 0 }}>
              <label>X Order</label>
              <button
                onClick={() => setXSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                title={xSortDir === 'asc' ? 'Ascending — click to switch to descending' : 'Descending — click to switch to ascending'}
              >
                {xSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>
          </>
        )}

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', userSelect: 'none', margin: 0 }}>
          <input
            type="checkbox"
            checked={showLegend}
            onChange={e => setShowLegend(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Legend
        </label>

        {/* Chart views */}
        {(chartViews.length > 0 || onSaveView) && (
          <>
            <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch', margin: '0 4px' }} />
            <select
              defaultValue=""
              onChange={e => {
                const view = chartViews.find(v => v.name === e.target.value)
                if (view) loadView(view)
                e.target.value = ''
              }}
              disabled={chartViews.length === 0}
              style={{ fontSize: 12, padding: '3px 6px' }}
              title="Load a saved view"
            >
              <option value="">{chartViews.length === 0 ? 'No saved views' : 'Load view…'}</option>
              {chartViews.map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
            {onSaveView && (
              <button
                onClick={handleSaveView}
                disabled={savingView}
                style={{ fontSize: 12, padding: '3px 10px' }}
                title="Save current chart settings as a named view"
              >
                {savingView ? 'Saving…' : 'Save view'}
              </button>
            )}
            {savedMsg && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                ✓ {savedMsg}
              </span>
            )}
          </>
        )}
      </div>

      {saveError && (
        <div className="error-banner" style={{ fontSize: 12 }}>{saveError}</div>
      )}

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
