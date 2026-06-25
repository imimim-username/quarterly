/**
 * MultiQueryChart — combine results from multiple saved queries into a single
 * ECharts chart with type-compatible X-axis alignment.
 *
 * X-axis values are aligned via shared groupBy bucketing: timestamps don't
 * need to match exactly, only be the same type (unix seconds).
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import * as echarts from 'echarts'
import { listQueries, createRun } from '../api/client.js'
import { mergeDatasets, formatXLabel } from '../utils/mergeDatasets.js'

// ─── constants ────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = ['day', 'week', 'month', 'none']
const AGGREGATION_OPTIONS = ['sum', 'avg', 'median', 'min', 'max', 'count']
const Y_MODE_OPTIONS = ['raw', 'cumulative']
const CHART_TYPES = ['line', 'bar', 'area']
const DIVISOR_CYCLE = ['raw', '1e6', '1e18']
const DIVISOR_LABELS = { raw: 'raw', '1e6': '÷1e6', '1e18': '÷1e18' }

/** Compact axis tick formatter */
function fmtAxisVal(val) {
  const abs = Math.abs(val)
  if (abs >= 1e12) return `${+(val / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${+(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${+(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${+(val / 1e3).toFixed(2)}K`
  return String(val)
}

const PALETTE = [
  '#e94560', '#2196f3', '#4caf50', '#ff9800',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
  '#f06292', '#aed581', '#4dd0e1', '#ffb74d',
]

// ─── ECharts wrapper ──────────────────────────────────────────────────────────

function ECharts({ option, style }) {
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
    instanceRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={containerRef} style={style} />
}

// ─── Dataset entry ─────────────────────────────────────────────────────────────

/**
 * A single dataset row in the dataset manager.
 * Shows: query name, X-field picker, groupBy, aggregation, Run button, status.
 */
function DatasetRow({ dataset, allColumns, onUpdate, onRemove, onRun }) {
  const { name, xField, groupBy, aggregation, yMode, colDivisors, status, error } = dataset

  const cycleDivisor = useCallback((col) => {
    const cur = colDivisors?.[col] || 'raw'
    const next = DIVISOR_CYCLE[(DIVISOR_CYCLE.indexOf(cur) + 1) % DIVISOR_CYCLE.length]
    onUpdate({ colDivisors: { ...colDivisors, [col]: next } })
  }, [colDivisors, onUpdate])

  const statusColor = status === 'done' ? 'var(--color-success, #4caf50)'
    : status === 'running' ? 'var(--color-warning, #ff9800)'
    : status === 'error' ? 'var(--color-error, #e94560)'
    : 'var(--color-text-muted)'

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{name}</span>
        {status && (
          <span style={{ fontSize: 11, color: statusColor }}>
            {status === 'running' ? '⏳ running…'
              : status === 'done' ? `✓ ${dataset.rowCount ?? ''} rows`
              : status === 'error' ? `✗ ${error || 'error'}`
              : ''}
          </span>
        )}
        <button
          onClick={onRun}
          disabled={status === 'running'}
          style={{ fontSize: 11, padding: '3px 10px' }}
        >
          {status === 'running' ? 'Running…' : 'Run'}
        </button>
        <button
          onClick={onRemove}
          style={{ fontSize: 11, padding: '3px 8px', color: 'var(--color-error)', background: 'transparent', borderColor: 'var(--color-error)' }}
        >
          ✕
        </button>
      </div>

      {/* Config row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* X field */}
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          X:
          <select
            value={xField || ''}
            onChange={e => onUpdate({ xField: e.target.value })}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            <option value="">— pick column —</option>
            {allColumns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/* GroupBy */}
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Group:
          <select
            value={groupBy || 'day'}
            onChange={e => onUpdate({ groupBy: e.target.value })}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {GROUP_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        {/* Aggregation */}
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Agg:
          <select
            value={aggregation || 'sum'}
            onChange={e => onUpdate({ aggregation: e.target.value })}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {AGGREGATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        {/* Y mode */}
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Mode:
          <select
            value={yMode || 'raw'}
            onChange={e => onUpdate({ yMode: e.target.value })}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {Y_MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>

      {/* Divisor badges for columns that appear in any series */}
      {allColumns.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {allColumns.filter(c => c !== xField).map(c => {
            const div = colDivisors?.[c] || 'raw'
            return (
              <span
                key={c}
                onClick={() => cycleDivisor(c)}
                title="Click to cycle divisor: raw → ÷1e6 → ÷1e18"
                style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  color: div !== 'raw' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                {c} · {DIVISOR_LABELS[div]}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Series entry ─────────────────────────────────────────────────────────────

function SeriesRow({ series, datasets, paletteColor, onUpdate, onRemove }) {
  const { datasetIdx, field, label, yAxis, type, color } = series

  const ds = datasets[datasetIdx]
  const columns = useMemo(() => {
    if (!ds?.rows?.length) return ds?.lastColumns || []
    const cols = Object.keys(ds.rows[0])
    return cols.filter(c => c !== ds.xField)
  }, [ds])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '6px 8px',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      borderLeft: `3px solid ${color || paletteColor}`,
    }}>
      {/* Color swatch */}
      <input
        type="color"
        value={color || paletteColor}
        onChange={e => onUpdate({ color: e.target.value })}
        style={{ width: 22, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
        title="Series color"
      />

      {/* Dataset picker */}
      <select
        value={datasetIdx}
        onChange={e => onUpdate({ datasetIdx: Number(e.target.value), field: '' })}
        style={{ fontSize: 11, padding: '1px 4px', maxWidth: 120 }}
      >
        {datasets.map((ds, i) => (
          <option key={i} value={i}>{ds?.name || `Dataset ${i + 1}`}</option>
        ))}
      </select>

      {/* Field picker */}
      <select
        value={field || ''}
        onChange={e => onUpdate({ field: e.target.value })}
        style={{ fontSize: 11, padding: '1px 4px', maxWidth: 130 }}
      >
        <option value="">— field —</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {/* Custom label */}
      <input
        type="text"
        placeholder="label (optional)"
        value={label || ''}
        onChange={e => onUpdate({ label: e.target.value })}
        style={{ fontSize: 11, padding: '1px 6px', width: 120 }}
      />

      {/* Chart type */}
      <select
        value={type || 'line'}
        onChange={e => onUpdate({ type: e.target.value })}
        style={{ fontSize: 11, padding: '1px 4px' }}
      >
        {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Y axis */}
      <select
        value={yAxis || 'left'}
        onChange={e => onUpdate({ yAxis: e.target.value })}
        style={{ fontSize: 11, padding: '1px 4px' }}
      >
        <option value="left">left Y</option>
        <option value="right">right Y</option>
      </select>

      <button
        onClick={onRemove}
        style={{ fontSize: 11, padding: '1px 6px', background: 'transparent', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiQueryChart({ colorSchemes = [] }) {
  // All saved queries from the API
  const [savedQueries, setSavedQueries] = useState([])
  const [queriesLoaded, setQueriesLoaded] = useState(false)

  // Datasets: each has { id, queryId, name, xField, groupBy, aggregation, yMode,
  //                       colDivisors, status, rows, rowCount, error, lastColumns }
  const [datasets, setDatasets] = useState([])

  // Series: each has { id, datasetIdx, field, label, yAxis, type, color }
  const [seriesList, setSeriesList] = useState([])

  // Chart options
  const [connectNulls, setConnectNulls] = useState(false)
  const [showLegend, setShowLegend] = useState(true)

  // Load saved queries once
  useEffect(() => {
    listQueries().then(({ data }) => {
      if (Array.isArray(data)) setSavedQueries(data)
      setQueriesLoaded(true)
    })
  }, [])

  // ── Dataset operations ──────────────────────────────────────────────────────

  const addDataset = useCallback((queryId) => {
    const query = savedQueries.find(q => q.id === queryId)
    if (!query) return
    setDatasets(prev => [...prev, {
      id: `ds_${Date.now()}`,
      queryId,
      name: query.name,
      xField: '',
      groupBy: 'day',
      aggregation: 'sum',
      yMode: 'raw',
      colDivisors: {},
      status: null,
      rows: null,
      rowCount: 0,
      error: null,
      lastColumns: [],
    }])
  }, [savedQueries])

  const updateDataset = useCallback((idx, patch) => {
    setDatasets(prev => prev.map((ds, i) => i === idx ? { ...ds, ...patch } : ds))
  }, [])

  const removeDataset = useCallback((idx) => {
    setDatasets(prev => {
      const removed = prev.filter((_, i) => i !== idx)
      // Remove series that referenced this dataset; renumber higher indices
      setSeriesList(sl => sl
        .filter(s => s.datasetIdx !== idx)
        .map(s => ({ ...s, datasetIdx: s.datasetIdx > idx ? s.datasetIdx - 1 : s.datasetIdx }))
      )
      return removed
    })
  }, [])

  const runDataset = useCallback(async (idx) => {
    const ds = datasets[idx]
    if (!ds) return
    updateDataset(idx, { status: 'running', error: null })
    try {
      const { data } = await createRun({ query_id: ds.queryId })
      if (data?.rows) {
        const cols = data.rows.length > 0 ? Object.keys(data.rows[0]) : []
        // Auto-detect xField: prefer 'timestamp' or first numeric-looking col
        const autoX = ds.xField || cols.find(c => c === 'timestamp' || c.includes('time') || c.includes('date')) || cols[0] || ''
        updateDataset(idx, {
          status: 'done',
          rows: data.rows,
          rowCount: data.rows.length,
          lastColumns: cols,
          xField: ds.xField || autoX,
        })
      } else {
        updateDataset(idx, {
          status: 'error',
          error: data?.error_message || 'No rows returned',
        })
      }
    } catch (e) {
      updateDataset(idx, { status: 'error', error: e.message })
    }
  }, [datasets, updateDataset])

  const runAll = useCallback(() => {
    datasets.forEach((_, idx) => runDataset(idx))
  }, [datasets, runDataset])

  // ── Series operations ───────────────────────────────────────────────────────

  const addSeries = useCallback(() => {
    // Default to first dataset with data
    const dsIdx = datasets.findIndex(d => d.rows?.length > 0)
    setSeriesList(prev => [...prev, {
      id: `s_${Date.now()}`,
      datasetIdx: dsIdx >= 0 ? dsIdx : 0,
      field: '',
      label: '',
      yAxis: 'left',
      type: 'line',
      color: '',
    }])
  }, [datasets])

  const updateSeries = useCallback((idx, patch) => {
    setSeriesList(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }, [])

  const removeSeries = useCallback((idx) => {
    setSeriesList(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // ── Compute merged data ─────────────────────────────────────────────────────

  // Build the per-dataset descriptors for mergeDatasets()
  const mergeInputs = useMemo(() => {
    return datasets.map((ds, idx) => {
      // Collect all fields referenced by series for this dataset
      const dsYFields = seriesList
        .filter(s => s.datasetIdx === idx && s.field)
        .map(s => s.field)
        .filter((f, i, a) => a.indexOf(f) === i) // unique

      return {
        id: ds.id,
        rows: ds.rows || [],
        xField: ds.xField || '',
        yFields: dsYFields,
        colDivisors: ds.colDivisors || {},
        groupBy: ds.groupBy || 'day',
        aggregation: ds.aggregation || 'sum',
        yMode: ds.yMode || 'raw',
      }
    })
  }, [datasets, seriesList])

  const { xKeys, rows: mergedRows } = useMemo(() => {
    const hasSomeSeries = seriesList.some(s => s.field)
    const hasSomeData = datasets.some(d => d.rows?.length > 0)
    if (!hasSomeSeries || !hasSomeData) return { xKeys: [], rows: [] }

    return mergeDatasets(mergeInputs)
  }, [mergeInputs, seriesList, datasets])

  // Detect the shared groupBy (use the first dataset's groupBy for label formatting)
  const sharedGroupBy = datasets[0]?.groupBy || 'day'

  // X axis labels
  const xLabels = useMemo(
    () => xKeys.map(k => formatXLabel(k, sharedGroupBy)),
    [xKeys, sharedGroupBy]
  )

  // Build ECharts series array
  const echartsSeriesList = useMemo(() => {
    return seriesList
      .filter(s => s.field)
      .map((s, i) => {
        const mergedKey = `d${s.datasetIdx}_${s.field}`
        const ds = datasets[s.datasetIdx]
        const displayName = s.label || `${ds?.name || `Dataset ${s.datasetIdx + 1}`} · ${s.field}`
        const color = s.color || PALETTE[i % PALETTE.length]
        const data = mergedRows.map(r => r[mergedKey] ?? null)

        return {
          name: displayName,
          type: s.type === 'area' ? 'line' : (s.type || 'line'),
          yAxisIndex: s.yAxis === 'right' ? 1 : 0,
          data,
          color,
          areaStyle: s.type === 'area' ? { opacity: 0.25 } : undefined,
          smooth: s.type !== 'bar',
          lineStyle: { width: 2 },
          symbol: mergedRows.length > 100 ? 'none' : 'circle',
          symbolSize: 4,
          connectNulls,
        }
      })
  }, [seriesList, mergedRows, datasets, connectNulls])

  // ECharts option
  const chartOption = useMemo(() => {
    const hasRight = seriesList.some(s => s.yAxis === 'right' && s.field)
    return {
      backgroundColor: 'transparent',
      animation: false,
      legend: showLegend ? { show: true, top: 4, type: 'scroll', textStyle: { fontSize: 11 } } : { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params) => {
          if (!params.length) return ''
          const label = params[0].axisValueLabel || params[0].name
          const lines = params.map(p => {
            const v = p.value
            const fmt = v == null ? 'null' : fmtAxisVal(v)
            return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:5px"></span>${p.seriesName}: <b>${fmt}</b>`
          })
          return `<div style="font-size:12px"><strong>${label}</strong><br/>${lines.join('<br/>')}</div>`
        },
      },
      toolbox: {
        feature: {
          dataZoom: { yAxisIndex: 'none' },
          restore: {},
          saveAsImage: {},
        },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100, height: 20 },
      ],
      grid: { top: showLegend ? 48 : 16, right: hasRight ? 60 : 20, bottom: 60, left: 60 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 11, rotate: xLabels.length > 20 ? 30 : 0 },
        boundaryGap: echartsSeriesList.some(s => s.type === 'bar'),
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { fontSize: 11, formatter: fmtAxisVal },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.07)' } },
        },
        hasRight ? {
          type: 'value',
          axisLabel: { fontSize: 11, formatter: fmtAxisVal },
          splitLine: { show: false },
        } : { show: false },
      ],
      series: echartsSeriesList,
    }
  }, [echartsSeriesList, xLabels, showLegend, seriesList])

  // ── Column list for each dataset (from rows or lastColumns) ─────────────────
  const datasetColumns = useCallback((ds) => {
    if (ds.rows?.length > 0) return Object.keys(ds.rows[0])
    return ds.lastColumns || []
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────

  const noData = !mergedRows.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>

      {/* Top controls strip */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Add dataset */}
        <select
          value=""
          onChange={e => { if (e.target.value) { addDataset(Number(e.target.value)); e.target.value = '' } }}
          style={{ fontSize: 12, padding: '4px 8px' }}
          disabled={!queriesLoaded}
        >
          <option value="">+ Add Dataset…</option>
          {savedQueries.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>

        {datasets.length > 1 && (
          <button
            onClick={runAll}
            disabled={datasets.some(d => d.status === 'running')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Run All
          </button>
        )}

        <button
          onClick={addSeries}
          style={{ fontSize: 12, padding: '4px 10px' }}
          disabled={datasets.length === 0}
        >
          + Add Series
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={connectNulls} onChange={e => setConnectNulls(e.target.checked)} />
            Connect nulls
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} />
            Legend
          </label>
        </div>
      </div>

      {/* Datasets panel */}
      {datasets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Datasets
          </div>
          {datasets.map((ds, idx) => (
            <DatasetRow
              key={ds.id}
              dataset={ds}
              allColumns={datasetColumns(ds)}
              onUpdate={patch => updateDataset(idx, patch)}
              onRemove={() => removeDataset(idx)}
              onRun={() => runDataset(idx)}
            />
          ))}
        </div>
      )}

      {/* Series panel */}
      {seriesList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Series
          </div>
          {seriesList.map((s, idx) => (
            <SeriesRow
              key={s.id}
              series={s}
              datasets={datasets}
              paletteColor={PALETTE[idx % PALETTE.length]}
              onUpdate={patch => updateSeries(idx, patch)}
              onRemove={() => removeSeries(idx)}
            />
          ))}
        </div>
      )}

      {/* Empty states */}
      {datasets.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
          Add one or more datasets to get started.
          <br />
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Each dataset is an independent query — results are aligned by X-axis bucket.
          </span>
        </div>
      )}

      {datasets.length > 0 && seriesList.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Click "+ Add Series" to pick which columns to plot on the chart.
        </div>
      )}

      {/* Chart */}
      {!noData && (
        <div style={{ flex: 1, minHeight: 320 }}>
          <ECharts
            option={chartOption}
            style={{ width: '100%', height: '100%', minHeight: 320 }}
          />
        </div>
      )}

      {seriesList.length > 0 && seriesList.every(s => s.field) && noData && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          No data yet — run the datasets above.
        </div>
      )}
    </div>
  )
}
