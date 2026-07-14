import React, {
  useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle,
} from 'react'
import * as echarts from 'echarts'
import { createRun } from '../api/client.js'
import { applyComputedColumns } from '../utils/computedColumns.js'
import { applyTimestampExtraction } from '../utils/timestampExtraction.js'

// ─── Chart helpers (mirrors ResultsChart logic) ───────────────────────────────

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

function buildEChartsOption(chartData, leftFields, rightFields, leftType, rightType, fieldMeta, seriesColors, palette, showLegend, groupBy, xField) {
  const allFields = [...leftFields, ...rightFields]
  const xLabels = chartData.map(p => fmtXLabel(p.x, groupBy, xField))

  const makeSeries = (fields, yAxisIdx, type, colorOffset) =>
    fields.map((f, i) => {
      const color = seriesColors[f] ?? palette[(colorOffset+i)%palette.length]
      const label = fieldMeta[f]?.label || f
      return {
        name: label,
        type: type === 'area' ? 'line' : type,
        yAxisIndex: yAxisIdx,
        data: chartData.map(p => p[f] ?? null),
        areaStyle: type==='area' ? {opacity:0.25} : undefined,
        smooth: type!=='bar',
        color,
        lineStyle: {width:2},
        symbol: chartData.length>100 ? 'none' : 'circle',
        symbolSize: 4,
        connectNulls: false,
      }
    })

  const yAxes = [
    { type:'value', axisLabel:{formatter:fmtAxisVal}, splitLine:{lineStyle:{color:'#333'}}, scale:false },
  ]
  if (rightFields.length > 0) {
    yAxes.push({ type:'value', axisLabel:{formatter:fmtAxisVal}, splitLine:{show:false}, scale:false })
  }

  return {
    backgroundColor: 'transparent',
    legend: showLegend ? { show:true, top:4, textStyle:{fontSize:10} } : { show:false },
    grid: { left:52, right:rightFields.length>0?52:12, top:showLegend?36:12, bottom:40, containLabel:false },
    tooltip: { trigger:'axis', axisPointer:{type:'cross'} },
    xAxis: {
      type:'category', data:xLabels,
      axisLabel: { rotate: xLabels.length>20?30:0, fontSize:10 },
      splitLine: { show:false },
    },
    yAxis: yAxes,
    series: [
      ...makeSeries(leftFields, 0, leftType, 0),
      ...makeSeries(rightFields, rightFields.length>0?1:0, rightType, leftFields.length),
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

// ─── Detect filterable columns (mirrors ResultFilters logic) ─────────────────

function isIntegerOnly(rows, field) {
  for (const row of rows) {
    const val = row[field]
    if (val === null || val === undefined || val === '') continue
    if (!/^-?\d+$/.test(String(val))) return false
  }
  return true
}

function detectFilterable(rows) {
  if (!rows || !rows.length) return []
  return Object.keys(rows[0])
    .filter(col => !isIntegerOnly(rows, col))
    .map(col => {
      const vals = [...new Set(rows.map(r=>r[col]).filter(v=>v!=null&&v!=='').map(String))].sort()
      return { col, vals }
    })
    .filter(({ vals }) => vals.length >= 2 && vals.length <= 50)
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
  { instance, allQueries, startDate, endDate, onUpdate, onDelete, palette },
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

  const filterableFields = useMemo(() => detectFilterable(previewRows), [previewRows])

  // ── Filtered rows for chart ──
  const filteredRows = useMemo(() => filterRows(previewRows, config.activeFilters), [previewRows, config.activeFilters])

  // ── Chart data ──
  const allYFields = [...(config.leftFields ?? []), ...(config.rightFields ?? [])]
  const chartDataLeft = useMemo(() =>
    buildChartData(filteredRows, config.xField, config.leftFields ?? [], config.colDivisors ?? {}, config.groupBy, config.leftYMode, config.leftAggregation, config.xSortDir),
    [filteredRows, config.xField, config.leftFields, config.colDivisors, config.groupBy, config.leftYMode, config.leftAggregation, config.xSortDir]
  )
  const chartDataRight = useMemo(() =>
    buildChartData(filteredRows, config.xField, config.rightFields ?? [], config.colDivisors ?? {}, config.groupBy, config.rightYMode, config.rightAggregation, config.xSortDir),
    [filteredRows, config.xField, config.rightFields, config.colDivisors, config.groupBy, config.rightYMode, config.rightAggregation, config.xSortDir]
  )

  // Merge left+right onto shared x axis
  const mergedChartData = useMemo(() => {
    const map = new Map()
    for (const p of chartDataLeft) map.set(p.x, { ...p })
    for (const p of chartDataRight) {
      if (map.has(p.x)) Object.assign(map.get(p.x), p)
      else map.set(p.x, { ...p })
    }
    return [...map.values()].sort((a,b)=>{
      const an=Number(a.x),bn=Number(b.x)
      return (!isNaN(an)&&!isNaN(bn))?an-bn:String(a.x).localeCompare(String(b.x))
    })
  }, [chartDataLeft, chartDataRight])

  const echartsOption = useMemo(() =>
    buildEChartsOption(
      mergedChartData,
      config.leftFields ?? [],
      config.rightFields ?? [],
      config.leftType,
      config.rightType,
      fieldMeta,
      config.seriesColors ?? {},
      palette ?? FALLBACK_COLORS,
      config.showLegend,
      config.groupBy,
      config.xField,
    ),
    [mergedChartData, config, fieldMeta, palette]
  )

  // ── Persist changes ──
  const patchConfig = useCallback((patch) => {
    setConfig(prev => {
      const next = { ...prev, ...patch }
      onUpdate?.({ config: next })
      return next
    })
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
      // Ensure preview is run
      if (runStatus !== 'done') {
        await runPreview()
      }
      await new Promise(r => setTimeout(r, 300)) // let chart render

      let dataUrl = null
      if (chartInstanceRef.current) {
        dataUrl = chartInstanceRef.current.getDataURL({
          type: 'png',
          pixelRatio: 2,
          backgroundColor: '#1a1f2e',
        })
      }

      const filename = buildFilename(query, label, config, startDate, endDate)
      return { dataUrl, filename }
    },
    getLabel: () => label,
    getQueryName: () => query?.name ?? '',
  }), [runPreview, runStatus, query, label, config, startDate, endDate])

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
                exclude={[config.xField, ...(config.rightFields ?? [])]}
                onChange={v => patchConfig({ leftFields: v })}
                colDivisors={config.colDivisors ?? {}}
                onDivisorChange={d => patchConfig({ colDivisors: d })}
              />
              <FieldPicker
                label="Right Y Fields"
                selected={config.rightFields ?? []}
                allColumns={allColumns}
                exclude={[config.xField, ...(config.leftFields ?? [])]}
                onChange={v => patchConfig({ rightFields: v })}
                colDivisors={config.colDivisors ?? {}}
                onDivisorChange={d => patchConfig({ colDivisors: d })}
              />
            </div>
          )}

          {/* Filters — only available after preview run */}
          {filterableFields.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom: 6 }}>
                Filters
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filterableFields.map(({ col, vals }) => {
                  const active = config.activeFilters?.[col] ?? []
                  const allActive = active.length === 0
                  const toggle = (val) => {
                    const next = allActive
                      ? [val]
                      : active.includes(val) ? active.filter(v=>v!==val) : [...active, val]
                    patchConfig({ activeFilters: { ...(config.activeFilters ?? {}), [col]: next.length===vals.length?[]:next } })
                  }
                  return (
                    <div key={col} style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'var(--color-text-muted)', minWidth:56, textAlign:'right', flexShrink:0 }}>{col}</span>
                      <button
                        onClick={() => patchConfig({ activeFilters: { ...(config.activeFilters ?? {}), [col]: [] } })}
                        style={{ fontSize:10, padding:'1px 6px', background:allActive?'var(--color-accent)':'transparent', color:allActive?'#fff':undefined }}
                      >all</button>
                      {vals.map(val => (
                        <button
                          key={val}
                          onClick={() => toggle(val)}
                          style={{
                            fontSize:10, padding:'1px 6px',
                            background: !allActive && active.includes(val) ? 'var(--color-accent)' : 'transparent',
                            color: !allActive && active.includes(val) ? '#fff' : undefined,
                          }}
                        >{val.length > 16 ? val.slice(0,8)+'…'+val.slice(-5) : val}</button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <hr style={{ border:'none', borderTop:'1px solid var(--color-border)', margin:0 }} />

          {/* Run preview button + status */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
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
