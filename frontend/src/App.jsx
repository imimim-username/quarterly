import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import EndpointBar from './components/EndpointBar.jsx'
import DateRangePicker from './components/DateRangePicker.jsx'
import QuerySidebar from './components/QuerySidebar.jsx'
import QueryEditor from './components/QueryEditor.jsx'
import ResultsTable from './components/ResultsTable.jsx'
import ResultsChart from './components/ResultsChart.jsx'
import ExportButtons from './components/ExportButtons.jsx'
import HistoryDrawer from './components/HistoryDrawer.jsx'
import CompareView from './components/CompareView.jsx'
import ResultFilters from './components/ResultFilters.jsx'
import SchemaExplorer from './components/SchemaExplorer.jsx'
import AddressBook from './components/AddressBook.jsx'
import ImportExportModal from './components/ImportExportModal.jsx'
import QueryPreviewModal from './components/QueryPreviewModal.jsx'
import EndpointProfilesModal from './components/EndpointProfilesModal.jsx'
import ReportsPanel from './components/ReportsPanel.jsx'
import { createRun, listAddressLabels, updateQuery, createQuery, updateSettings } from './api/client.js'

function divisorsFromFieldMeta(fm) {
  const d = {}
  for (const [col, meta] of Object.entries(fm || {})) {
    if (meta?.decimals === 6) d[col] = '1e6'
    else if (meta?.decimals === 18) d[col] = '1e18'
  }
  return d
}

export default function App() {
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  const [selectedQuery, setSelectedQuery] = useState(null)
  const [tab, setTab] = useState('editor') // 'editor' | 'results' | 'compare' | 'reports'
  const [colDivisors, setColDivisors] = useState({})
  const [running, setRunning] = useState(false)
  const [currentRun, setCurrentRun] = useState(null)
  const [runError, setRunError] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [compareRuns, setCompareRuns] = useState(null) // { runA, runB }
  const [activeFilters, setActiveFilters] = useState({})
  const [sidebarRefresh, setSidebarRefresh] = useState(0)
  const [schemaExplorerOpen, setSchemaExplorerOpen] = useState(false)
  const [addressBookOpen, setAddressBookOpen] = useState(false)
  const [importExportOpen, setImportExportOpen] = useState(false)
  const [queryPreviewOpen, setQueryPreviewOpen] = useState(false)
  const [endpointProfilesOpen, setEndpointProfilesOpen] = useState(false)
  const [endpointVersion, setEndpointVersion] = useState(0)
  const [addressLabels, setAddressLabels] = useState([])
  const [prefillGql, setPrefillGql] = useState(null)

  useEffect(() => {
    listAddressLabels().then(({ data }) => { if (data) setAddressLabels(data) })
  }, [])

  const abortRef = useRef(null)

  const handleSelectQuery = useCallback((query) => {
    setSelectedQuery(query)
    setCurrentRun(null)
    setRunError(null)
    setActiveFilters({})
    const fm = typeof query?.field_meta === 'object' ? query.field_meta : {}
    setColDivisors(divisorsFromFieldMeta(fm))
    setTab('editor')
    setHistoryOpen(false)
  }, [])

  const handleNewQuery = useCallback(() => {
    setSelectedQuery(null)
    setCurrentRun(null)
    setRunError(null)
    setPrefillGql(null)
    setColDivisors({})
    setTab('editor')
  }, [])

  const handleUseQuery = useCallback((gql) => {
    setSchemaExplorerOpen(false)
    setSelectedQuery(null)
    setCurrentRun(null)
    setRunError(null)
    setPrefillGql(gql)
    setTab('editor')
  }, [])

  const handleSaveQuery = useCallback((saved) => {
    setSelectedQuery(saved)
    setSidebarRefresh(n => n + 1)
  }, [])

  const handleDeleteQuery = useCallback(() => {
    setSelectedQuery(null)
    setCurrentRun(null)
    setSidebarRefresh(n => n + 1)
  }, [])

  const handleCloneQuery = useCallback(async (query) => {
    const { name, ...rest } = query
    let newName = name + ' (copy)'
    const result = await createQuery({ ...rest, name: newName })
    if (result.ok) {
      setSidebarRefresh(n => n + 1)
    }
  }, [])

  const handleSelectEndpointProfile = useCallback(async (profile) => {
    if (profile.url) {
      await updateSettings({ endpoint: profile.url })
      setEndpointVersion(v => v + 1) // force EndpointBar to remount & re-read
    }
  }, [])

  const handleSaveChartView = useCallback(async (view) => {
    if (!selectedQuery?.id) return
    const existing = Array.isArray(selectedQuery.chart_views) ? selectedQuery.chart_views : []
    const updated = existing.some(v => v.name === view.name)
      ? existing.map(v => v.name === view.name ? view : v)
      : [...existing, view]
    const result = await updateQuery(selectedQuery.id, { ...selectedQuery, chart_views: updated })
    if (result.ok && result.data) {
      setSelectedQuery(result.data)
      setSidebarRefresh(n => n + 1)
    }
    return result.ok
  }, [selectedQuery])

  const handleDivisorChange = useCallback(async (newDivisors) => {
    setColDivisors(newDivisors)
    if (!selectedQuery?.id) return
    const currentMeta = typeof selectedQuery.field_meta === 'object'
      ? JSON.parse(JSON.stringify(selectedQuery.field_meta))
      : {}
    // Update all columns that have a divisor set
    for (const [col, div] of Object.entries(newDivisors)) {
      if (!currentMeta[col]) currentMeta[col] = {}
      if (div === '1e6') currentMeta[col].decimals = 6
      else if (div === '1e18') currentMeta[col].decimals = 18
      else delete currentMeta[col].decimals
    }
    // Clear decimals for cols previously tracked but now absent from newDivisors
    for (const col of Object.keys(currentMeta)) {
      if (!(col in newDivisors) && currentMeta[col]?.decimals != null) {
        delete currentMeta[col].decimals
      }
    }
    const result = await updateQuery(selectedQuery.id, { ...selectedQuery, field_meta: currentMeta })
    if (result.ok && result.data) setSelectedQuery(result.data)
  }, [selectedQuery])

  const handleRun = useCallback(async (queryDef) => {
    setRunning(true)
    setRunError(null)
    setCurrentRun(null)
    setActiveFilters({})
    setQueryPreviewOpen(false)
    setTab('results')

    // Create AbortController for this run
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body = {
        query_id: queryDef.id,
        start_date: startDate ? startDate.toISOString() : null,
        end_date: endDate ? endDate.toISOString() : null,
      }

      const { data, status } = await createRun(body, controller.signal)

      if (controller.signal.aborted) {
        setRunError({ error_type: 'cancelled', error_message: 'Run cancelled.' })
        return
      }

      if (data) {
        setCurrentRun(data)
        if (data.error_type && data.error_type !== 'graphql_partial') {
          setRunError(data)
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setRunError({ error_type: 'cancelled', error_message: 'Run cancelled.' })
      } else {
        setRunError({ error_type: 'network', error_message: e.message })
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [startDate, endDate])

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }

  const handleLoadRun = (run) => {
    setCurrentRun(run)
    setRunError(null)
    setActiveFilters({})
    setTab('results')
    setHistoryOpen(false)
  }

  const handleCompare = (runA, runB) => {
    setCompareRuns({ runA, runB })
    setTab('compare')
    setHistoryOpen(false)
  }

  // Filter rows by date range + active field chips (all ANDed)
  const filteredRows = useMemo(() => {
    if (!currentRun?.rows) return []
    let rows = currentRun.rows

    // Date range — assumes timestamp column is unix seconds (standard for current queries)
    if (startDate) {
      const s = startDate.getTime() / 1000
      rows = rows.filter(r => r.timestamp == null || Number(r.timestamp) >= s)
    }
    if (endDate) {
      const e = endDate.getTime() / 1000
      rows = rows.filter(r => r.timestamp == null || Number(r.timestamp) <= e)
    }

    // Field chip filters
    const entries = Object.entries(activeFilters).filter(([, vals]) => vals.length > 0)
    if (entries.length > 0) {
      rows = rows.filter(row =>
        entries.every(([field, vals]) => vals.includes(String(row[field])))
      )
    }

    return rows
  }, [currentRun, startDate, endDate, activeFilters])

  // True when the current date pickers extend *beyond* what the run fetched from the
  // server — i.e. the results may be missing data and the user should re-run.
  // Narrowing the range is fine (client-side filter handles it), only widening matters.
  const needsRerun = useMemo(() => {
    if (!currentRun || running) return false
    const runStart = currentRun.start_date ? new Date(currentRun.start_date) : null
    const runEnd   = currentRun.end_date   ? new Date(currentRun.end_date)   : null

    // Start side: need re-run if user wants data *before* what was originally fetched
    if (runStart !== null) {
      if (startDate === null) return true          // cleared → wants all early data
      if (startDate < runStart) return true        // moved earlier
    }

    // End side: need re-run if user wants data *after* what was originally fetched
    if (runEnd !== null) {
      if (endDate === null) return true            // cleared → wants all late data
      if (endDate > runEnd) return true            // moved later
    }

    return false
  }, [currentRun, startDate, endDate, running])

  const fieldMeta = typeof selectedQuery?.field_meta === 'object'
    ? selectedQuery.field_meta
    : {}

  return (
    <div className="app-layout">
      {/* Top bar */}
      <div className="app-topbar">
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-accent)', flexShrink: 0 }}>
          quarterly
        </span>
        <EndpointBar key={endpointVersion} onExplore={() => setSchemaExplorerOpen(true)} />
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
        />
        <button
          onClick={() => setEndpointProfilesOpen(true)}
          style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
          title="Manage endpoint profiles"
        >
          Profiles
        </button>
        <button
          onClick={() => setAddressBookOpen(true)}
          style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
          title="Manage address labels"
        >
          Address Book
        </button>
        <button
          onClick={() => setImportExportOpen(true)}
          style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
          title="Import or export queries, address book, and settings"
        >
          Import / Export
        </button>
        <button
          onClick={() => setHistoryOpen(o => !o)}
          disabled={!selectedQuery?.id}
          style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
          title="Toggle run history"
        >
          History
        </button>
      </div>

      {/* Body */}
      <div className="app-body">
        {/* Sidebar */}
        <div className="app-sidebar">
          <QuerySidebar
            selectedQueryId={selectedQuery?.id}
            onSelectQuery={handleSelectQuery}
            onNewQuery={handleNewQuery}
            onCloneQuery={handleCloneQuery}
            refreshTrigger={sidebarRefresh}
          />
        </div>

        {/* Main panel */}
        <div className="app-main">
          {/* Tab bar */}
          <div className="tab-bar">
            <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>Editor</button>
            <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Results</button>
            <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports</button>
            {compareRuns && (
              <button className={tab === 'compare' ? 'active' : ''} onClick={() => setTab('compare')}>Compare</button>
            )}
          </div>

          {/* Editor tab */}
          {tab === 'editor' && (
            <QueryEditor
              query={selectedQuery}
              prefillGql={prefillGql}
              onSave={handleSaveQuery}
              onDelete={handleDeleteQuery}
              onRun={handleRun}
              running={running}
            />
          )}

          {/* Results tab */}
          {tab === 'results' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Running state */}
              {running && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="spinner" />
                  <span style={{ color: 'var(--color-text-muted)' }}>Fetching pages…</span>
                  <button onClick={handleCancel} style={{ background: 'transparent', borderColor: 'var(--color-error)', color: 'var(--color-error)', padding: '3px 10px', fontSize: 12 }}>
                    Cancel
                  </button>
                </div>
              )}

              {/* Cancelled state */}
              {!running && runError?.error_type === 'cancelled' && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Run cancelled.</div>
              )}

              {/* Error state */}
              {!running && runError && runError.error_type !== 'cancelled' && (
                <div className="error-banner">
                  <strong>
                    {runError.error_type === 'network' ? 'Network error' :
                     runError.error_type === 'timeout' ? 'Request timed out' :
                     runError.error_type === 'size_limit' ? 'Response too large' :
                     runError.error_type === 'graphql' ? 'GraphQL error' :
                     runError.error_type === 'page_limit' ? 'Page limit exceeded' :
                     runError.error_type === 'row_limit' ? 'Row limit exceeded' :
                     runError.error_type === 'invalid_endpoint' ? 'Invalid endpoint' :
                     runError.error_type}
                  </strong>: {runError.error_message}
                  {runError.graphql_errors && (
                    <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 12 }}>
                      {runError.graphql_errors.map((e, i) => <li key={i}>{e.message}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* Warnings */}
              {currentRun?.warnings && currentRun.warnings.length > 0 && (
                <div className="warning-banner">
                  {currentRun.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}

              {/* graphql_partial notice */}
              {currentRun?.error_type === 'graphql_partial' && (
                <div className="warning-banner">
                  Partial result ({currentRun.row_count} rows): {currentRun.error_message}
                </div>
              )}

              {/* Run stats */}
              {currentRun && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span>{currentRun.row_count} rows</span>
                  <span>{currentRun.page_count} pages</span>
                  <span>{currentRun.duration_ms}ms</span>
                  <button
                    onClick={() => setQueryPreviewOpen(true)}
                    title="View the query and variables sent to the endpoint"
                    style={{ fontSize: 11, padding: '1px 7px', color: 'var(--color-text-muted)', background: 'transparent', border: '1px solid var(--color-border)' }}
                  >
                    View query
                  </button>
                  {currentRun.id && <ExportButtons runId={currentRun.id} />}
                </div>
              )}

              {/* Re-run nudge — date range widened beyond what was fetched */}
              {needsRerun && selectedQuery && !running && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 10px',
                  background: 'rgba(255,152,0,0.08)',
                  border: '1px solid var(--color-warning)',
                  borderRadius: 4,
                  fontSize: 12,
                  color: 'var(--color-warning)',
                }}>
                  <span>⚠ Date range extended beyond the fetched window — results may be incomplete.</span>
                  <button
                    onClick={() => handleRun(selectedQuery)}
                    style={{
                      fontSize: 11, padding: '2px 10px', flexShrink: 0,
                      borderColor: 'var(--color-warning)', color: 'var(--color-warning)',
                      background: 'transparent',
                    }}
                  >
                    ↻ Re-run
                  </button>
                </div>
              )}

              {/* Warning: no timestamp field */}
              {currentRun?.rows?.length > 0 && !('timestamp' in (currentRun.rows[0] ?? {})) && (
                <div className="warning-banner">
                  No <code>timestamp</code> field found in results — date range filtering will have no effect. Add <code>timestamp</code> to your query's field selection.
                </div>
              )}

              {/* Dynamic field filters */}
              {currentRun?.rows && currentRun.rows.length > 0 && (
                <ResultFilters
                  rows={currentRun.rows}
                  activeFilters={activeFilters}
                  onChange={setActiveFilters}
                  addressLabels={addressLabels}
                />
              )}

              {/* Results subtabs */}
              {currentRun?.rows && currentRun.rows.length > 0 && (
                <ResultsView
                  rows={filteredRows}
                  fieldMeta={fieldMeta}
                  keyField={selectedQuery?.key_field || 'id'}
                  addressLabels={addressLabels}
                  chartViews={selectedQuery?.chart_views || []}
                  onSaveView={selectedQuery?.id ? handleSaveChartView : undefined}
                  colDivisors={colDivisors}
                  onDivisorChange={handleDivisorChange}
                />
              )}

              {!running && !currentRun && !runError && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                  Select a query and click Run to see results.
                </div>
              )}
            </div>
          )}

          {/* Compare tab */}
          {tab === 'compare' && compareRuns && (
            <CompareView
              runA={compareRuns.runA}
              runB={compareRuns.runB}
              keyField={selectedQuery?.key_field || 'id'}
              fieldMeta={fieldMeta}
            />
          )}

          {/* Reports tab */}
          {tab === 'reports' && (
            <ReportsPanel startDate={startDate} endDate={endDate} />
          )}
        </div>
      </div>

      {/* Endpoint profiles overlay */}
      {endpointProfilesOpen && (
        <EndpointProfilesModal
          onClose={() => setEndpointProfilesOpen(false)}
          onSelect={handleSelectEndpointProfile}
        />
      )}

      {/* Address book overlay */}
      {addressBookOpen && (
        <AddressBook
          onClose={() => setAddressBookOpen(false)}
          onLabelsChange={setAddressLabels}
        />
      )}

      {/* Import / Export overlay */}
      {importExportOpen && (
        <ImportExportModal
          onClose={() => { setImportExportOpen(false); setSidebarRefresh(n => n + 1) }}
        />
      )}

      {/* Schema explorer overlay */}
      {schemaExplorerOpen && (
        <SchemaExplorer
          onClose={() => setSchemaExplorerOpen(false)}
          onUseQuery={handleUseQuery}
        />
      )}

      {/* Query preview modal */}
      {queryPreviewOpen && currentRun && (
        <QueryPreviewModal
          run={currentRun}
          onClose={() => setQueryPreviewOpen(false)}
        />
      )}

      {/* History drawer */}
      <HistoryDrawer
        queryId={selectedQuery?.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoadRun={handleLoadRun}
        onCompare={handleCompare}
      />
    </div>
  )
}

/**
 * Inner component for table/chart subtabs.
 */
function ResultsView({ rows, fieldMeta, keyField, addressLabels = [], chartViews = [], onSaveView, colDivisors = {}, onDivisorChange }) {
  const [view, setView] = useState('table')

  return (
    <div>
      <div className="tab-bar" style={{ marginBottom: 8 }}>
        <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
        <button className={view === 'chart' ? 'active' : ''} onClick={() => setView('chart')}>Chart</button>
      </div>
      {view === 'table' && <ResultsTable rows={rows} fieldMeta={fieldMeta} keyField={keyField} colDivisors={colDivisors} onDivisorChange={onDivisorChange} addressLabels={addressLabels} />}
      {view === 'chart' && <ResultsChart rows={rows} fieldMeta={fieldMeta} keyField={keyField} colDivisors={colDivisors} onDivisorChange={onDivisorChange} chartViews={chartViews} onSaveView={onSaveView} />}
    </div>
  )
}
