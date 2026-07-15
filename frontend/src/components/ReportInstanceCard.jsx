import React, {
  useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle,
} from 'react'
import * as echarts from 'echarts'
import { createRun } from '../api/client.js'
import { applyComputedColumns } from '../utils/computedColumns.js'
import { applyTimestampExtraction } from '../utils/timestampExtraction.js'
import ResultFilters from './ResultFilters.jsx'

// ─── Chart helpers (mirrors ResultsChart logic) ───────────────────────────────

// ─── Theme helpers ────────────────────────────────────────────────────────────

/** Convert a 3- or 6-digit hex color + 0-100 alpha into an rgba() string. */
function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(26,31,46,${(alpha ?? 100) / 100})`
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (full.length !== 6) return `rgba(26,31,46,${(alpha ?? 100) / 100})`
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${(alpha ?? 100) / 100})`
}

const CHART_TYPES = ['bar', 'line', 'area']
const GROUP_BY_OPTIONS = ['none', 'day', 'week', 'month']
const AGG_OPTIONS = ['sum', 'avg', 'median', 'min', 'max', 'count']
const Y_MODE_OPTIONS = ['raw', 'cumulative']
const DIVISOR_CYCLE = ['raw', '1e6', '1e18']
const DIVISOR_LABELS = { raw: 'raw', '1e6': '÷1e6', '1e18': '÷1e18' }
const FALLBACK_COLORS = ['#e94560','#2196f3','#4caf50','#ff9800','#9c27b0','#00bcd4','#ff5722','#607d8b']

function applyDivisorNumeric(value, divisor) {
  if (value === null || value === undefined || value === '') return null
  if (!divisor || divisor === 'raw' || divisor === 'datetime') return Number(value)
  try {
    const raw = BigInt(value)
    const decimals = divisor === '1e18' ? 18n : 6n
    const pow = 10n ** decimals
    return Number(raw / pow) + Number(raw % pow) / Number(pow)
  } catch { return Number(value) }
}

function bucketTimestamp(ts, groupBy) {
  const d = new Date(Number(ts) * 1000)
  if (groupBy === 'day')   return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
  if (groupBy === 'week')  return Math.floor(Number(ts) / 604800) * 604800
  if (groupBy === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  return Number(ts)
}

function aggregate(values, method) {
  const nums = values.filter(v => v !== null && !isNaN(v))
  if (!nums.length) return null
  switch (method) {
    case 'avg':    return nums.reduce((a,b)=>a+b,0)/nums.length
    case 'median': { const s=[...nums].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2===0?(s[m-1]+s[m])/2:s[m] }
    case 'min':    return Math.min(...nums)
    case 'max':    return Math.max(...nums)
    case 'count':  return nums.length
    default:       return nums.reduce((a,b)=>a+b,0)
  }
}

function buildChartData(rows, xField, yFields, colDivisors, groupBy, yMode, aggregation, xSortDir='asc') {
  if (!rows?.length || !xField || !yFields.length) return []
  const bucketKey = groupBy === 'none' ? r => r[xField] : r => bucketTimestamp(r[xField], groupBy)
  const map = new Map()
  for (const row of rows) {
    const key = bucketKey(row)
    if (!map.has(key)) map.set(key, Object.fromEntries(yFields.map(f=>[f,[]])))
    const entry = map.get(key)
    for (const f of yFields) {
      const v = applyDivisorNumeric(row[f], colDivisors[f])
      if (v !== null && !isNaN(v)) entry[f].push(v)
    }
  }
  let data = [...map.entries()].map(([key,arrs])=>{
    const p={x:key}; for(const f of yFields) p[f]=aggregate(arrs[f],aggregation); return p
  })
  data.sort((a,b)=>{ const an=Number(a.x),bn=Number(b.x); return (!isNaN(an)&&!isNaN(bn))?an-bn:String(a.x).localeCompare(String(b.x)) })
  if (xSortDir==='desc') data.reverse()
  if (yMode==='cumulative') {
    const running=Object.fromEntries(yFields.map(f=>[f,0]))
    data=data.map(p=>{ const q={...p}; for(const f of yFields){running[f]+=(q[f]??0);q[f]=running[f]}; return q })
  }
  return data
}

function fmtAxisVal(val) {
  const abs=Math.abs(val)
  if(abs>=1e12) return `${+(val/1e12).toFixed(2)}T`
  if(abs>=1e9)  return `${+(val/1e9).toFixed(2)}B`
  if(abs>=1e6)  return `${+(val/1e6).toFixed(2)}M`
  if(abs>=1e3)  return `${+(val/1e3).toFixed(2)}K`
  return String(val)
}

function fmtXLabel(val, groupBy, xField) {
  if (groupBy !== 'none') {
    const d = new Date(Number(val) * 1000)
    if (groupBy === 'month') return d.toLocaleDateString(undefined, {year:'2-digit',month:'short'})
    return d.toLocaleDateString(undefined, {month:'short',day:'numeric'})
  }
  const n = Number(val)
  if (!isNaN(n) && n > 1e9 && n < 2e10) return new Date(n*1000).toLocaleDateString()
  return String(val)
}

function buildEChartsOption(chartData, leftFields, rightFields, leftType, rightType, fieldMeta, seriesColors, reportTheme, showLegend, groupBy, xField, leftScaleY = false, rightScaleY = false, leftYMode = 'raw', rightYMode = 'raw') {
  const palette   = reportTheme?.palette   ?? FALLBACK_COLORS
  const textColor = reportTheme?.textColor ?? '#c0c0c0'
  const gridColor = reportTheme?.gridColor ?? '#333333'
  const axisColor = reportTheme?.axisColor ?? '#555555'
  const bgRgba    = hexToRgba(reportTheme?.bg ?? '#1a1f2e', reportTheme?.bgAlpha ?? 100)

  const xLabels = chartData.map(p => fmtXLabel(p.x, groupBy, xField))

  // Build a display label for a field, with optional "(R)" and "(cumulative)" suffixes
  const makeSeriesLabel = (f, yMode) => {
    const baseField = f.replace(/__right$/, '')
    const baseLabel = fieldMeta[baseField]?.label || baseField
    const rSuffix   = f.endsWith('__right') ? ' (R)' : ''
    const cumSuffix = yMode === 'cumulative' ? ' (cumulative)' : ''
    return `${baseLabel}${rSuffix}${cumSuffix}`
  }

  const makeSeries = (fields, yAxisIdx, type, colorOffset, yMode) =>
    fields.map((f, i) => {
      // rightFields may contain aliased names like "amount__right" when the same
      // field is used on both axes; resolve back to the base name for meta/color lookup
      const baseField = f.replace(/__right$/, '')
      const color = seriesColors[baseField] ?? palette[(colorOffset + i) % palette.length]
      return {
        name: makeSeriesLabel(f, yMode),
        type: type === 'area' ? 'line' : type,
        yAxisIndex: yAxisIdx,
        data: chartData.map(p => p[f] ?? null),
        areaStyle: type === 'area' ? { opacity: 0.25 } : undefined,
        smooth: type !== 'bar',
        color,
        lineStyle: { width: 2 },
        symbol: chartData.length > 100 ? 'none' : 'circle',
        symbolSize: 4,
        connectNulls: false,
      }
    })

  // Build a Y-axis name from the field list (joined labels, + "(cumulative)" if applicable)
  const makeAxisName = (fields, yMode) => {
    if (!fields.length) return undefined
    const labels = fields.map(f => {
      const base = f.replace(/__right$/, '')
      return fieldMeta[base]?.label || base
    })
    // Deduplicate (same field on both axes shows same base label)
    const unique = [...new Set(labels)]
    const name = unique.join(', ')
    return yMode === 'cumulative' ? `${name} (cumulative)` : name
  }

  const axisLabelStyle = { formatter: fmtAxisVal, fontSize: 10, color: textColor }
  const axisLineStyle  = { lineStyle: { color: axisColor } }
  const axisNameStyle  = { fontSize: 10, color: textColor, padding: [0, 0, 0, 0] }

  const leftAxisName = makeAxisName(leftFields, leftYMode)
  const yAxes = [
    {
      type: 'value',
      name: leftAxisName,
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: axisNameStyle,
      axisLabel: axisLabelStyle,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      splitLine: { lineStyle: { color: gridColor } },
      scale: leftScaleY,
    },
  ]
  if (rightFields.length > 0) {
    const rightAxisName = makeAxisName(rightFields, rightYMode)
    yAxes.push({
      type: 'value',
      name: rightAxisName,
      nameLocation: 'middle',
      nameGap: 48,
      nameTextStyle: axisNameStyle,
      axisLabel: axisLabelStyle,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      splitLine: { show: false },
      scale: rightScaleY,
    })
  }

  return {
    backgroundColor: bgRgba,
    textStyle: { color: textColor },
    legend: showLegend
      ? { show: true, top: 4, textStyle: { fontSize: 10, color: textColor } }
      : { show: false },
    grid: { left: 12, right: 12, top: showLegend ? 36 : 12, bottom: 40, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLabel: { rotate: xLabels.length > 20 ? 30 : 0, fontSize: 10, color: textColor },
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      splitLine: { show: false },
    },
    yAxis: yAxes,
    series: [
      ...makeSeries(leftFields, 0, leftType, 0, leftYMode),
      ...makeSeries(rightFields, rightFields.length > 0 ? 1 : 0, rightType, leftFields.length, rightYMode),
    ],
  }
}

// ─── Mini ECharts wrapper ────────────────────────────────────────────────────

function MiniChart({ option, height = 220, onInstance }) {
  const containerRef = useRef(null)
  const instanceRef = useRef(null)

  useEffect(() => {
    const chart = echarts.init(containerRef.current, 'dark')
    instanceRef.current = chart
    onInstance?.(chart)
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.dispose(); onInstance?.(null) }
  }, [])

  useEffect(() => {
    instanceRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={containerRef} style={{ width:'100%', height }} />
}

// ─── Filter rows for active filters ─────────────────────────────────────────

function filterRows(rows, activeFilters) {
  if (!rows || !activeFilters) return rows
  return rows.filter(row =>
    Object.entries(activeFilters).every(([col, vals]) =>
      !vals || vals.length === 0 || vals.includes(String(row[col]))
    )
  )
}

// ─── Default instance config ─────────────────────────────────────────────────

export function defaultInstanceConfig() {
  return {
    xField: 'timestamp',
    leftFields: [],
    rightFields: [],
    leftType: 'bar',
    rightType: 'line',
    groupBy: 'day',
    leftAggregation: 'sum',
    rightAggregation: 'sum',
    leftYMode: 'raw',
    rightYMode: 'raw',
    leftScaleY: false,
    rightScaleY: false,
    xSortDir: 'asc',
    showLegend: true,
    colDivisors: {},
    seriesColors: {},
    colorSchemeId: null,
    activeFilters: {},
  }
}

// ─── ReportInstanceCard ──────────────────────────────────────────────────────

/**
 * A single chart instance within a report.
 *
 * Props:
 *  instance  — { id?, query_id, label, config, query } — current saved state
 *  allQueries — full list of queries for the dropdown
 *  startDate, endDate — master date range (Date objects)
 *  onUpdate(patch)  — called with partial updates to persist { label, config, query_id }
 *  onDelete()       — called when the × button is clicked
 *  palette          — string[] color palette from active scheme
 *
 * Ref API:
 *  generate() → Promise<{ dataUrl: string, filename: string }>
 *    Runs a preview if needed, then returns the chart PNG and a suggested filename.
 */
const ReportInstanceCard = forwardRef(function ReportInstanceCard(
  { instance, allQueries, startDate, endDate, onUpdate, onDelete, reportTheme, addressLabels = [] },
  ref,
) {
  const [expanded, setExpanded] = useState(!instance.id) // new instances start expanded
  const [label, setLabel] = useState(instance.label ?? '')
  const [queryId, setQueryId] = useState(instance.query_id ?? '')
  const [config, setConfig] = useState({ ...defaultInstanceConfig(), ...(instance.config ?? {}) })

  // Preview state
  const [previewRows, setPreviewRows] = useState(null) // raw rows after post-processing
  const [runStatus, setRunStatus] = useState('idle') // idle | running | done | error
  const [runError, setRunError] = useState('')
  const chartInstanceRef = useRef(null)

  const query = useMemo(
    () => allQueries.find(q => q.id === Number(queryId)) ?? instance.query,
    [queryId, allQueries, instance.query],
  )

  const fieldMeta = useMemo(() => {
    try { return typeof query?.field_meta === 'string' ? JSON.parse(query.field_meta) : (query?.field_meta ?? {}) }
    catch { return {} }
  }, [query])

  // All columns available for selection: field_meta keys + any runtime columns
  const allColumns = useMemo(() => {
    const fromMeta = Object.keys(fieldMeta)
    const fromRows = previewRows?.length ? Object.keys(previewRows[0]) : []
    return [...new Set([...fromMeta, ...fromRows])]
  }, [fieldMeta, previewRows])

  // ── Filtered rows for chart ──
  const filteredRows = useMemo(() => filterRows(previewRows, config.activeFilters), [previewRows, config.activeFilters])

  // ── Chart data ──
  const chartDataLeft = useMemo(() =>
    buildChartData(filteredRows, config.xField, config.leftFields ?? [], config.colDivisors ?? {}, config.groupBy, config.leftYMode, config.leftAggregation, config.xSortDir),
    [filteredRows, config.xField, config.leftFields, config.colDivisors, config.groupBy, config.leftYMode, config.leftAggregation, config.xSortDir]
  )
  const chartDataRight = useMemo(() =>
    buildChartData(filteredRows, config.xField, config.rightFields ?? [], config.colDivisors ?? {}, config.groupBy, config.rightYMode, config.rightAggregation, config.xSortDir),
    [filteredRows, config.xField, config.rightFields, config.colDivisors, config.groupBy, config.rightYMode, config.rightAggregation, config.xSortDir]
  )

  // Fields that appear on both axes need an alias on the right side so they
  // don't overwrite the left value when merged onto the same x-keyed map.
  const effectiveRightFields = useMemo(() => {
    const leftSet = new Set(config.leftFields ?? [])
    return (config.rightFields ?? []).map(f => leftSet.has(f) ? `${f}__right` : f)
  }, [config.leftFields, config.rightFields])

  // Merge left+right onto shared x axis, aliasing overlapping right fields
  const mergedChartData = useMemo(() => {
    const leftSet = new Set(config.leftFields ?? [])
    const map = new Map()
    for (const p of chartDataLeft) map.set(p.x, { ...p })
    for (const p of chartDataRight) {
      const entry = map.has(p.x) ? map.get(p.x) : { x: p.x }
      for (const [k, v] of Object.entries(p)) {
        if (k === 'x') continue
        entry[leftSet.has(k) ? `${k}__right` : k] = v
      }
      if (!map.has(p.x)) map.set(p.x, entry)
    }
    const sorted = [...map.values()].sort((a,b)=>{
      const an=Number(a.x),bn=Number(b.x)
      return (!isNaN(an)&&!isNaN(bn))?an-bn:String(a.x).localeCompare(String(b.x))
    })
    return config.xSortDir === 'desc' ? sorted.reverse() : sorted
  }, [chartDataLeft, chartDataRight, config.leftFields, config.xSortDir])

  const echartsOption = useMemo(() =>
    buildEChartsOption(
      mergedChartData,
      config.leftFields ?? [],
      effectiveRightFields,
      config.leftType,
      config.rightType,
      fieldMeta,
      config.seriesColors ?? {},
      reportTheme,
      config.showLegend,
      config.groupBy,
      config.xField,
      config.leftScaleY ?? false,
      config.rightScaleY ?? false,
      config.leftYMode ?? 'raw',
      config.rightYMode ?? 'raw',
    ),
    [mergedChartData, effectiveRightFields, config, fieldMeta, reportTheme]
  )

  // Keep a ref to the latest config so patchConfig can compute next without
  // reading stale closure values, and without calling onUpdate inside a state setter.
  const configRef = useRef(config)
  configRef.current = config

  // ── Persist changes ──
  const patchConfig = useCallback((patch) => {
    const next = { ...configRef.current, ...patch }
    setConfig(next)
    // onUpdate must be called outside the state setter to avoid
    // "Cannot update a component while rendering a different component"
    onUpdate?.({ config: next })
  }, [onUpdate])

  const handleLabelBlur = () => onUpdate?.({ label })
  const handleQueryChange = (e) => {
    setQueryId(Number(e.target.value))
    setPreviewRows(null)
    setRunStatus('idle')
    onUpdate?.({ query_id: Number(e.target.value) })
  }

  // ── Run preview ──
  const runPreview = useCallback(async () => {
    if (!queryId || !query) return
    setRunStatus('running')
    setRunError('')
    try {
      const body = {
        query_id: Number(queryId),
        start_date: startDate ? startDate.toISOString() : null,
        end_date: endDate ? endDate.toISOString() : null,
      }
      const { data, ok } = await createRun(body)
      if (!ok) throw new Error(data?.message || 'Run failed')

      let rows = Array.isArray(data.rows) ? data.rows : (typeof data.rows === 'string' ? JSON.parse(data.rows) : [])

      // Apply timestamp extraction
      const tsConfig = typeof query.timestamp_extraction === 'string'
        ? JSON.parse(query.timestamp_extraction || 'null')
        : query.timestamp_extraction
      if (tsConfig) rows = applyTimestampExtraction(rows, tsConfig)

      // Apply computed columns
      const compCols = typeof query.computed_columns === 'string'
        ? JSON.parse(query.computed_columns || '[]')
        : (query.computed_columns ?? [])
      if (compCols.length) rows = applyComputedColumns(rows, compCols, config.colDivisors ?? {})

      setPreviewRows(rows)
      setRunStatus('done')

      // Auto-set xField and leftFields from fieldMeta if not yet configured
      setConfig(prev => {
        const next = { ...prev }
        const cols = rows.length ? Object.keys(rows[0]) : []
        if (!prev.xField || !cols.includes(prev.xField)) {
          // Prefer timestamp-like field
          const tsCand = cols.find(c => c.toLowerCase().includes('timestamp') || c.toLowerCase().includes('date')) ?? cols[0]
          next.xField = tsCand ?? prev.xField
        }
        if ((!prev.leftFields || !prev.leftFields.length) && cols.length > 1) {
          // Auto-pick first numeric-looking column that isn't xField
          const numCols = cols.filter(c => c !== next.xField && !c.toLowerCase().includes('id'))
          next.leftFields = numCols.slice(0, 1)
        }
        return next
      })
    } catch (e) {
      setRunStatus('error')
      setRunError(e.message)
    }
  }, [queryId, query, startDate, endDate, config.colDivisors])

  // ── Expose generate() to parent via ref ──
  useImperativeHandle(ref, () => ({
    async generate() {
      // Ensure card is expanded so MiniChart mounts and chartInstanceRef can be set
      setExpanded(true)

      // Ensure preview data is available
      if (runStatus !== 'done') {
        await runPreview()
      }

      // Poll until ECharts instance is ready (React re-renders + MiniChart init).
      // Timeout after 5 s — if still null, dataUrl will be null and the caller skips it.
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 100))
        if (chartInstanceRef.current) break
      }

      let dataUrl = null
      if (chartInstanceRef.current) {
        const bgColor = hexToRgba(reportTheme?.bg ?? '#1a1f2e', reportTheme?.bgAlpha ?? 100)
        dataUrl = chartInstanceRef.current.getDataURL({
          type: 'png',
          pixelRatio: 2,
          backgroundColor: bgColor,
        })
      }

      const filename = buildFilename(query, label, config, startDate, endDate)
      return { dataUrl, filename }
    },
    getLabel: () => label,
    getQueryName: () => query?.name ?? '',
  }), [runPreview, runStatus, query, label, config, startDate, endDate, reportTheme])

  const q = allQueries.find(q => q.id === Number(queryId))
  const queryDisplayName = q ? `${q.category} / ${q.name}` : '— select query —'

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      background: 'var(--color-surface)',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--color-surface2)',
        cursor: 'pointer',
        userSelect: 'none',
      }} onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 14 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {queryDisplayName}
        </span>
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 500,
          color: label ? 'var(--color-text)' : 'var(--color-text-muted)',
          fontStyle: label ? 'normal' : 'italic',
        }}>
          {label || '(no label)'}
        </span>
        {runStatus === 'done' && (
          <span style={{ fontSize: 11, color: 'var(--color-success)', flexShrink: 0 }}>● preview ready</span>
        )}
        {runStatus === 'running' && (
          <span style={{ fontSize: 11, color: 'var(--color-accent)', flexShrink: 0 }}>● running…</span>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete?.() }}
          style={{ background:'transparent', border:'none', color:'var(--color-error)', fontSize:16, cursor:'pointer', padding:'0 4px', flexShrink:0 }}
          title="Remove instance"
        >×</button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Query + Label */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Query</label>
              <select value={queryId} onChange={handleQueryChange} style={{ fontSize: 12 }}>
                <option value="">— select —</option>
                {allQueries.map(q => (
                  <option key={q.id} value={q.id}>{q.category} / {q.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Instance Label</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                onBlur={handleLabelBlur}
                placeholder="e.g. ETH Deposits"
                style={{ fontSize: 12 }}
              />
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0' }} />

          {/* Chart settings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom: 8 }}>
              Chart Settings
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {/* X Field */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>X Field</label>
                <select value={config.xField} onChange={e => patchConfig({ xField: e.target.value })} style={{ fontSize: 11 }}>
                  {allColumns.length === 0 && <option value="timestamp">timestamp</option>}
                  {allColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Group By */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Group By</label>
                <select value={config.groupBy} onChange={e => patchConfig({ groupBy: e.target.value })} style={{ fontSize: 11 }}>
                  {GROUP_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* X Sort */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>X Sort</label>
                <select value={config.xSortDir} onChange={e => patchConfig({ xSortDir: e.target.value })} style={{ fontSize: 11 }}>
                  <option value="asc">asc</option>
                  <option value="desc">desc</option>
                </select>
              </div>

              {/* Left type */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Left Type</label>
                <select value={config.leftType} onChange={e => patchConfig({ leftType: e.target.value })} style={{ fontSize: 11 }}>
                  {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Left mode */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Left Mode</label>
                <select value={config.leftYMode} onChange={e => patchConfig({ leftYMode: e.target.value })} style={{ fontSize: 11 }}>
                  {Y_MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Left aggregation */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Left Agg</label>
                <select value={config.leftAggregation} onChange={e => patchConfig({ leftAggregation: e.target.value })} style={{ fontSize: 11 }}>
                  {AGG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Right type */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Right Type</label>
                <select value={config.rightType} onChange={e => patchConfig({ rightType: e.target.value })} style={{ fontSize: 11 }}>
                  {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Right mode */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Right Mode</label>
                <select value={config.rightYMode} onChange={e => patchConfig({ rightYMode: e.target.value })} style={{ fontSize: 11 }}>
                  {Y_MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Right aggregation */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Right Agg</label>
                <select value={config.rightAggregation} onChange={e => patchConfig({ rightAggregation: e.target.value })} style={{ fontSize: 11 }}>
                  {AGG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Left scale */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Left Scale</label>
                <select value={config.leftScaleY ? 'auto' : 'zero'} onChange={e => patchConfig({ leftScaleY: e.target.value === 'auto' })} style={{ fontSize: 11 }}>
                  <option value="zero">from zero</option>
                  <option value="auto">auto</option>
                </select>
              </div>

              {/* Right scale */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Right Scale</label>
                <select value={config.rightScaleY ? 'auto' : 'zero'} onChange={e => patchConfig({ rightScaleY: e.target.value === 'auto' })} style={{ fontSize: 11 }}>
                  <option value="zero">from zero</option>
                  <option value="auto">auto</option>
                </select>
              </div>

              {/* Legend */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>Legend</label>
                <select value={config.showLegend ? 'show' : 'hide'} onChange={e => patchConfig({ showLegend: e.target.value === 'show' })} style={{ fontSize: 11 }}>
                  <option value="show">show</option>
                  <option value="hide">hide</option>
                </select>
              </div>
            </div>
          </div>

          {/* Y-axis field pickers */}
          {allColumns.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FieldPicker
                label="Left Y Fields"
                selected={config.leftFields ?? []}
                allColumns={allColumns}
                exclude={[config.xField]}
                onChange={v => patchConfig({ leftFields: v })}
                colDivisors={config.colDivisors ?? {}}
                onDivisorChange={d => patchConfig({ colDivisors: d })}
              />
              <FieldPicker
                label="Right Y Fields"
                selected={config.rightFields ?? []}
                allColumns={allColumns}
                exclude={[config.xField]}
                onChange={v => patchConfig({ rightFields: v })}
                colDivisors={config.colDivisors ?? {}}
                onDivisorChange={d => patchConfig({ colDivisors: d })}
              />
            </div>
          )}

          {/* Filters — only available after preview run; address book labels applied */}
          {previewRows && previewRows.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom: 6 }}>
                Filters
              </div>
              <ResultFilters
                rows={previewRows}
                activeFilters={config.activeFilters ?? {}}
                onChange={activeFilters => patchConfig({ activeFilters })}
                addressLabels={addressLabels}
              />
            </div>
          )}

          <hr style={{ border:'none', borderTop:'1px solid var(--color-border)', margin:0 }} />

          {/* Run preview button + status */}
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <button
              onClick={runPreview}
              disabled={!queryId || runStatus === 'running'}
              style={{ background:'var(--color-accent)', border:'none', fontSize:12, padding:'5px 14px' }}
            >
              {runStatus === 'running' ? '⟳ Running…' : '▶ Run Preview'}
            </button>
            {runStatus === 'error' && (
              <span style={{ fontSize:11, color:'var(--color-error)' }}>{runError}</span>
            )}
            {runStatus === 'done' && previewRows && (
              <span style={{ fontSize:11, color:'var(--color-text-muted)' }}>
                {previewRows.length.toLocaleString()} rows
                {Object.values(config.activeFilters ?? {}).some(v=>v.length>0)
                  ? ` → ${filteredRows?.length.toLocaleString()} filtered`
                  : ''}
              </span>
            )}
          </div>

          {/* Preview chart */}
          {runStatus === 'done' && mergedChartData.length > 0 && (
            <MiniChart
              option={echartsOption}
              height={240}
              onInstance={inst => { chartInstanceRef.current = inst }}
            />
          )}

          {runStatus === 'done' && mergedChartData.length === 0 && (
            <div style={{ fontSize:12, color:'var(--color-text-muted)', padding:'20px 0', textAlign:'center' }}>
              No chart data — select at least one Y field and run a preview.
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ─── FieldPicker ─────────────────────────────────────────────────────────────

function FieldPicker({ label, selected, allColumns, exclude, onChange, colDivisors, onDivisorChange }) {
  const available = allColumns.filter(c => !exclude.includes(c))

  const toggle = (col) => {
    const next = selected.includes(col) ? selected.filter(c=>c!==col) : [...selected, col]
    onChange(next)
  }

  const cycleDivisor = (col, e) => {
    e.stopPropagation()
    const cur = colDivisors[col] || 'raw'
    const next = DIVISOR_CYCLE[(DIVISOR_CYCLE.indexOf(cur)+1) % DIVISOR_CYCLE.length]
    onDivisorChange({ ...colDivisors, [col]: next })
  }

  return (
    <div className="form-group" style={{ margin:0 }}>
      <label style={{ fontSize:11 }}>{label}</label>
      <div style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:100, overflowY:'auto', border:'1px solid var(--color-border)', borderRadius:4, padding:'4px 6px' }}>
        {available.map(col => (
          <div key={col} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" id={`fp-${label}-${col}`} checked={selected.includes(col)} onChange={() => toggle(col)} />
            <label htmlFor={`fp-${label}-${col}`} style={{ fontSize:11, cursor:'pointer', flex:1 }}>{col}</label>
            {selected.includes(col) && (
              <button
                onClick={e => cycleDivisor(col, e)}
                title={`Divisor: ${DIVISOR_LABELS[colDivisors[col]||'raw']}`}
                style={{ fontSize:9, padding:'1px 4px', opacity:0.7 }}
              >
                {DIVISOR_LABELS[colDivisors[col]||'raw']}
              </button>
            )}
          </div>
        ))}
        {available.length === 0 && (
          <span style={{ fontSize:11, color:'var(--color-text-muted)' }}>
            {allColumns.length === 0 ? 'Run preview first' : 'No available fields'}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Filename builder ─────────────────────────────────────────────────────────

function slugify(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function buildFilename(query, label, config, startDate, endDate) {
  const parts = []
  if (query?.category) parts.push(slugify(query.category))
  if (query?.name)     parts.push(slugify(query.name))
  if (label)           parts.push(slugify(label))

  // Top active filters (max 3 to keep name readable)
  const filterParts = []
  for (const [col, vals] of Object.entries(config.activeFilters ?? {})) {
    if (vals && vals.length > 0) {
      filterParts.push(`${slugify(col)}=${vals.map(slugify).join('+')}`)
    }
    if (filterParts.length >= 3) break
  }
  if (filterParts.length) parts.push(filterParts.join(','))

  if (startDate) parts.push(startDate.toISOString().slice(0, 10))
  if (endDate)   parts.push(`to_${endDate.toISOString().slice(0, 10)}`)

  return parts.join('_').replace(/__+/g, '_') + '.png'
}

export default ReportInstanceCard
