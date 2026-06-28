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
import ResultFilters from './ResultFilters.jsx'

// ─── constants ────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = ['day', 'week', 'month', 'none']
const AGGREGATION_OPTIONS = ['sum', 'avg', 'median', 'min', 'max', 'count']
const Y_MODE_OPTIONS = ['raw', 'cumulative']
const CHART_TYPES = ['line', 'bar', 'area']
const DIVISOR_CYCLE = ['raw', '1e6', '1e18']
const DIVISOR_LABELS = { raw: 'raw', '1e6': '÷1e6', '1e18': '÷1e18' }

const DEFAULT_PALETTE = [
  '#e94560', '#2196f3', '#4caf50', '#ff9800',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
  '#f06292', '#aed581', '#4dd0e1', '#ffb74d',
]

const LS_KEY = 'mqc_configs'

/** Compact axis tick formatter */
function fmtAxisVal(val) {
  const abs = Math.abs(val)
  if (abs >= 1e12) return `${+(val / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${+(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${+(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${+(val / 1e3).toFixed(2)}K`
  return String(val)
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadSavedConfigs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}

function writeSavedConfigs(configs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(configs)) } catch {}
}

// Strip runtime-only fields before saving a dataset config
function serializeDataset(ds) {
  const { rows, status, rowCount, error, ...config } = ds
  return config
}

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

// ─── Dataset entry ────────────────────────────────────────────────────────────

function DatasetRow({ dataset, allColumns, onUpdate, onRemove, onRun, addressLabels }) {
  const { name, xField, groupBy, aggregation, yMode, colDivisors, status, error, activeFilters, rows } = dataset

  const cycleDivisor = useCallback((col) => {
    const cur = colDivisors?.[col] || 'raw'
    const next = DIVISOR_CYCLE[(DIVISOR_CYCLE.indexOf(cur) + 1) % DIVISOR_CYCLE.length]
    onUpdate({ colDivisors: { ...colDivisors, [col]: next } })
  }, [colDivisors, onUpdate])

  const statusColor = status === 'done'    ? 'var(--color-success, #4caf50)'
    : status === 'running' ? 'var(--color-warning, #ff9800)'
    : status === 'error'   ? 'var(--color-error, #e94560)'
    : 'var(--color-text-muted)'

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{name}</span>
        {status && (
          <span style={{ fontSize: 11, color: statusColor }}>
            {status === 'running' ? '⏳ running…'
              : status === 'done'  ? `✓ ${dataset.rowCount ?? ''} rows`
              : status === 'error' ? `✗ ${error || 'error'}`
              : ''}
          </span>
        )}
        <button onClick={onRun} disabled={status === 'running'} style={{ fontSize: 11, padding: '3px 10px' }}>
          {status === 'running' ? 'Running…' : 'Run'}
        </button>
        <button onClick={onRemove} style={{ fontSize: 11, padding: '3px 8px', color: 'var(--color-error)', background: 'transparent', borderColor: 'var(--color-error)' }}>
          ✕
        </button>
      </div>

      {/* Config row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          X:
          <select value={xField || ''} onChange={e => onUpdate({ xField: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
            <option value="">— pick column —</option>
            {allColumns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {allColumns.length === 0 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>run first</span>
          )}
        </label>

        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Group:
          <select value={groupBy || 'day'} onChange={e => onUpdate({ groupBy: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
            {GROUP_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Agg:
          <select value={aggregation || 'sum'} onChange={e => onUpdate({ aggregation: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
            {AGGREGATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Mode:
          <select value={yMode || 'raw'} onChange={e => onUpdate({ yMode: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
            {Y_MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>

      {/* Divisor badges — click to cycle raw → ÷1e6 → ÷1e18 */}
      {allColumns.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginRight: 2 }}>divisors:</span>
          {allColumns.filter(c => c !== xField).map(c => {
            const div = colDivisors?.[c] || 'raw'
            const active = div !== 'raw'
            return (
              <button key={c} onClick={() => cycleDivisor(c)} title="Click to cycle: raw → ÷1e6 → ÷1e18"
                style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
                  background: active ? 'var(--color-accent)' : 'var(--color-surface2)',
                  color: active ? '#fff' : 'var(--color-text-muted)',
                  fontWeight: active ? 600 : 400,
                }}>
                {c}{active ? ` ${DIVISOR_LABELS[div]}` : ''}
              </button>
            )
          })}
        </div>
      )}

      {/* Column value filters — same chip UI as the Results tab */}
      {rows?.length > 0 && (
        <ResultFilters
          rows={rows}
          activeFilters={activeFilters || {}}
          onChange={filters => onUpdate({ activeFilters: filters })}
          addressLabels={addressLabels}
        />
      )}
    </div>
  )
}

// ─── Series entry ─────────────────────────────────────────────────────────────

function SeriesRow({ series, datasets, paletteColor, onUpdate, onRemove }) {
  const { datasetIdx, field, label, yAxis, type, color } = series

  const ds = datasets[datasetIdx]
  const columns = useMemo(() => {
    if (ds?.rows?.length > 0) return Object.keys(ds.rows[0]).filter(c => c !== ds.xField)
    return (ds?.lastColumns || []).filter(c => c !== ds?.xField)
  }, [ds])

  const noColumns = columns.length === 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, borderLeft: `3px solid ${color || paletteColor}` }}>
      <input type="color" value={color || paletteColor} onChange={e => onUpdate({ color: e.target.value })}
        style={{ width: 22, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} title="Series color" />

      <select value={datasetIdx} onChange={e => onUpdate({ datasetIdx: Number(e.target.value), field: '' })} style={{ fontSize: 11, padding: '1px 4px', maxWidth: 120 }}>
        {datasets.map((ds, i) => <option key={i} value={i}>{ds?.name || `Dataset ${i + 1}`}</option>)}
      </select>

      <select value={field || ''} onChange={e => onUpdate({ field: e.target.value })} style={{ fontSize: 11, padding: '1px 4px', maxWidth: 130 }}>
        <option value="">{noColumns ? '— run dataset first —' : '— field —'}</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <input type="text" placeholder="label (optional)" value={label || ''} onChange={e => onUpdate({ label: e.target.value })}
        style={{ fontSize: 11, padding: '1px 6px', width: 120 }} />

      <select value={type || 'line'} onChange={e => onUpdate({ type: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
        {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={yAxis || 'left'} onChange={e => onUpdate({ yAxis: e.target.value })} style={{ fontSize: 11, padding: '1px 4px' }}>
        <option value="left">left Y</option>
        <option value="right">right Y</option>
      </select>

      <button onClick={onRemove} style={{ fontSize: 11, padding: '1px 6px', background: 'transparent', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}>✕</button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiQueryChart({ startDate, endDate, colorSchemes = [], addressLabels = [] }) {
  const [savedQueries, setSavedQueries] = useState([])
  const [queriesLoaded, setQueriesLoaded] = useState(false)

  // Datasets: { id, queryId, name, xField, groupBy, aggregation, yMode,
  //             colDivisors, status, rows, rowCount, error, lastColumns }
  const [datasets, setDatasets] = useState([])

  // Series: { id, datasetIdx, field, label, yAxis, type, color }
  const [seriesList, setSeriesList] = useState([])

  // Chart options
  const [connectNulls, setConnectNulls] = useState(false)
  const [showLegend, setShowLegend]     = useState(true)

  // Color scheme — null means use DEFAULT_PALETTE
  const [schemeId, setSchemeId] = useState(null)

  // Save/load UI state
  const [savedConfigs, setSavedConfigs] = useState(loadSavedConfigs)
  const [saveName, setSaveName]         = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  const palette = useMemo(() => {
    if (!schemeId) return DEFAULT_PALETTE
    const scheme = colorSchemes.find(s => s.id === schemeId)
    return scheme?.colors?.length ? scheme.colors : DEFAULT_PALETTE
  }, [schemeId, colorSchemes])

  useEffect(() => {
    listQueries().then(({ data }) => {
      if (Array.isArray(data)) setSavedQueries(data)
      setQueriesLoaded(true)
    })
  }, [])

  // ── Save / Load ─────────────────────────────────────────────────────────────

  const saveConfig = useCallback(() => {
    const name = saveName.trim()
    if (!name) return
    const entry = {
      name,
      savedAt: new Date().toISOString(),
      datasets: datasets.map(serializeDataset),
      seriesList,
      connectNulls,
      showLegend,
      schemeId,
    }
    const updated = [...savedConfigs.filter(c => c.name !== name), entry]
    writeSavedConfigs(updated)
    setSavedConfigs(updated)
    setSaveName('')
    setShowSaveInput(false)
  }, [datasets, seriesList, connectNulls, showLegend, schemeId, saveName, savedConfigs])

  const loadConfig = useCallback((name) => {
    const config = savedConfigs.find(c => c.name === name)
    if (!config) return
    // Restore datasets without rows — user will re-run
    setDatasets(config.datasets.map(ds => ({
      ...ds,
      rows: null,
      status: null,
      rowCount: 0,
      error: null,
      lastColumns: ds.lastColumns || [],
      activeFilters: ds.activeFilters || {},
    })))
    setSeriesList(config.seriesList || [])
    setConnectNulls(config.connectNulls ?? false)
    setShowLegend(config.showLegend ?? true)
    setSchemeId(config.schemeId ?? null)
  }, [savedConfigs])

  const deleteConfig = useCallback((name) => {
    const updated = savedConfigs.filter(c => c.name !== name)
    writeSavedConfigs(updated)
    setSavedConfigs(updated)
  }, [savedConfigs])

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
      activeFilters: {},
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
    setDatasets(prev => prev.filter((_, i) => i !== idx))
    setSeriesList(prev => prev
      .filter(s => s.datasetIdx !== idx)
      .map(s => ({ ...s, datasetIdx: s.datasetIdx > idx ? s.datasetIdx - 1 : s.datasetIdx }))
    )
  }, [])

  const runDataset = useCallback(async (idx) => {
    const ds = datasets[idx]
    if (!ds) return
    updateDataset(idx, { status: 'running', error: null })
    try {
      const body = {
        query_id: ds.queryId,
        start_date: startDate ? startDate.toISOString() : null,
        end_date:   endDate   ? endDate.toISOString()   : null,
      }
      const { data } = await createRun(body)
      if (data?.rows) {
        const cols = data.rows.length > 0 ? Object.keys(data.rows[0]) : []
        const autoX = ds.xField
          || cols.find(c => c === 'timestamp' || c.includes('time') || c.includes('date'))
          || cols[0] || ''
        updateDataset(idx, {
          status: 'done',
          rows: data.rows,
          rowCount: data.rows.length,
          lastColumns: cols,
          xField: ds.xField || autoX,
        })
      } else {
        updateDataset(idx, { status: 'error', error: data?.error_message || 'No rows returned' })
      }
    } catch (e) {
      updateDataset(idx, { status: 'error', error: e.message })
    }
  }, [datasets, updateDataset, startDate, endDate])

  const runAll = useCallback(() => {
    datasets.forEach((_, idx) => runDataset(idx))
  }, [datasets, runDataset])

  // ── Series operations ───────────────────────────────────────────────────────

  const addSeries = useCallback(() => {
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

  const mergeInputs = useMemo(() => datasets.map((ds, idx) => {
    // Pre-filter rows by the dataset's active column-value filters
    let rows = ds.rows || []
    const filterEntries = Object.entries(ds.activeFilters || {}).filter(([, vals]) => vals.length > 0)
    if (filterEntries.length > 0) {
      rows = rows.filter(row => filterEntries.every(([f, vals]) => vals.includes(String(row[f]))))
    }

    const dsYFields = seriesList
      .filter(s => s.datasetIdx === idx && s.field)
      .map(s => s.field)
      .filter((f, i, a) => a.indexOf(f) === i)

    return {
      id: ds.id,
      rows,
      xField: ds.xField || '',
      yFields: dsYFields,
      colDivisors: ds.colDivisors || {},
      groupBy: ds.groupBy || 'day',
      aggregation: ds.aggregation || 'sum',
      yMode: ds.yMode || 'raw',
    }
  }), [datasets, seriesList])

  const { xKeys, rows: mergedRows } = useMemo(() => {
    if (!seriesList.some(s => s.field) || !datasets.some(d => d.rows?.length > 0)) {
      return { xKeys: [], rows: [] }
    }
    return mergeDatasets(mergeInputs)
  }, [mergeInputs, seriesList, datasets])

  const sharedGroupBy = datasets[0]?.groupBy || 'day'
  const xLabels = useMemo(() => xKeys.map(k => formatXLabel(k, sharedGroupBy)), [xKeys, sharedGroupBy])

  const echartsSeriesList = useMemo(() => seriesList
    .filter(s => s.field)
    .map((s, i) => {
      const mergedKey = `d${s.datasetIdx}_${s.field}`
      const ds = datasets[s.datasetIdx]
      const displayName = s.label || `${ds?.name || `Dataset ${s.datasetIdx + 1}`} · ${s.field}`
      const color = s.color || palette[i % palette.length]
      return {
        name: displayName,
        type: s.type === 'area' ? 'line' : (s.type || 'line'),
        yAxisIndex: s.yAxis === 'right' ? 1 : 0,
        data: mergedRows.map(r => r[mergedKey] ?? null),
        color,
        areaStyle: s.type === 'area' ? { opacity: 0.25 } : undefined,
        smooth: s.type !== 'bar',
        lineStyle: { width: 2 },
        symbol: mergedRows.length > 100 ? 'none' : 'circle',
        symbolSize: 4,
        connectNulls,
      }
    }), [seriesList, mergedRows, datasets, connectNulls, palette])

  const chartOption = useMemo(() => {
    const hasRight = seriesList.some(s => s.yAxis === 'right' && s.field)
    return {
      backgroundColor: 'transparent',
      animation: false,
      legend: showLegend ? { show: true, top: 4, type: 'scroll', textStyle: { fontSize: 11 } } : { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: params => {
          if (!params.length) return ''
          const label = params[0].axisValueLabel || params[0].name
          const lines = params.map(p => {
            const fmt = p.value == null ? 'null' : fmtAxisVal(p.value)
            return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:5px"></span>${p.seriesName}: <b>${fmt}</b>`
          })
          return `<div style="font-size:12px"><strong>${label}</strong><br/>${lines.join('<br/>')}</div>`
        },
      },
      toolbox: { feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: {} } },
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
        { type: 'value', axisLabel: { fontSize: 11, formatter: fmtAxisVal }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.07)' } } },
        hasRight
          ? { type: 'value', axisLabel: { fontSize: 11, formatter: fmtAxisVal }, splitLine: { show: false } }
          : { show: false },
      ],
      series: echartsSeriesList,
    }
  }, [echartsSeriesList, xLabels, showLegend, seriesList])

  const datasetColumns = useCallback(ds => {
    if (ds.rows?.length > 0) return Object.keys(ds.rows[0])
    return ds.lastColumns || []
  }, [])

  const noData = !mergedRows.length

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>

      {/* ── Top controls strip ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value="" onChange={e => { if (e.target.value) { addDataset(Number(e.target.value)); e.target.value = '' } }}
          style={{ fontSize: 12, padding: '4px 8px' }} disabled={!queriesLoaded}>
          <option value="">+ Add Dataset…</option>
          {savedQueries.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>

        {datasets.length > 1 && (
          <button onClick={runAll} disabled={datasets.some(d => d.status === 'running')} style={{ fontSize: 12, padding: '4px 10px' }}>
            Run All
          </button>
        )}

        <button onClick={addSeries} style={{ fontSize: 12, padding: '4px 10px' }} disabled={datasets.length === 0}>
          + Add Series
        </button>

        {/* Color scheme picker */}
        {colorSchemes.length > 0 && (
          <select value={schemeId || ''} onChange={e => setSchemeId(e.target.value || null)} style={{ fontSize: 11, padding: '1px 4px' }} title="Color scheme">
            <option value="">Default palette</option>
            {colorSchemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={connectNulls} onChange={e => setConnectNulls(e.target.checked)} />
            Connect nulls
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} />
            Legend
          </label>

          {/* Save config */}
          {showSaveInput ? (
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Config name…"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveConfig(); if (e.key === 'Escape') setShowSaveInput(false) }}
                autoFocus
                style={{ fontSize: 11, padding: '2px 6px', width: 130 }}
              />
              <button onClick={saveConfig} disabled={!saveName.trim()} style={{ fontSize: 11, padding: '2px 8px' }}>Save</button>
              <button onClick={() => setShowSaveInput(false)} style={{ fontSize: 11, padding: '2px 6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>✕</button>
            </span>
          ) : (
            <button onClick={() => setShowSaveInput(true)} style={{ fontSize: 11, padding: '2px 8px' }} disabled={datasets.length === 0} title="Save current chart config">
              Save config
            </button>
          )}

          {/* Load config */}
          {savedConfigs.length > 0 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                value=""
                onChange={e => { if (e.target.value) { loadConfig(e.target.value); e.target.value = '' } }}
                style={{ fontSize: 11, padding: '1px 4px' }}
                title="Load a saved config"
              >
                <option value="">Load config…</option>
                {savedConfigs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              {/* Delete button for each saved config shown inline via title attr — separate select for deleting */}
              <select
                value=""
                onChange={e => { if (e.target.value) { deleteConfig(e.target.value); e.target.value = '' } }}
                style={{ fontSize: 11, padding: '1px 4px', color: 'var(--color-error)' }}
                title="Delete a saved config"
              >
                <option value="">Delete…</option>
                {savedConfigs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Date range notice when active */}
      {(startDate || endDate) && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📅 Date filter active:</span>
          {startDate && <span>{startDate.toLocaleDateString()}</span>}
          {startDate && endDate && <span>→</span>}
          {endDate && <span>{endDate.toLocaleDateString()}</span>}
          <span style={{ opacity: 0.7 }}>(applied to all runs)</span>
        </div>
      )}

      {/* ── Datasets panel ── */}
      {datasets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Datasets</div>
          {datasets.map((ds, idx) => (
            <DatasetRow key={ds.id} dataset={ds} allColumns={datasetColumns(ds)}
              onUpdate={patch => updateDataset(idx, patch)}
              onRemove={() => removeDataset(idx)}
              onRun={() => runDataset(idx)}
              addressLabels={addressLabels}
            />
          ))}
        </div>
      )}

      {/* ── Series panel ── */}
      {seriesList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Series</div>
          {seriesList.map((s, idx) => (
            <SeriesRow key={s.id} series={s} datasets={datasets}
              paletteColor={palette[idx % palette.length]}
              onUpdate={patch => updateSeries(idx, patch)}
              onRemove={() => removeSeries(idx)}
            />
          ))}
        </div>
      )}

      {/* ── Empty states ── */}
      {datasets.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
          Add one or more datasets to get started.
          <br />
          <span style={{ fontSize: 12, opacity: 0.7 }}>Each dataset is an independent query — results are aligned by X-axis bucket.</span>
        </div>
      )}

      {datasets.length > 0 && seriesList.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Click "+ Add Series" to pick which columns to plot on the chart.
        </div>
      )}

      {/* ── Chart ── */}
      {!noData && (
        <div style={{ flex: 1, minHeight: 320 }}>
          <ECharts option={chartOption} style={{ width: '100%', height: '100%', minHeight: 320 }} />
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
