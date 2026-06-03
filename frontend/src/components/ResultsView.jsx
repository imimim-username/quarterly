import React, { useState } from 'react'
import ResultsTable from './ResultsTable.jsx'
import ResultsChart from './ResultsChart.jsx'

/**
 * Table / Chart subtab switcher for the results panel.
 *
 * Both sub-components are kept mounted at all times (hidden via display:none
 * rather than conditional rendering). This preserves ResultsChart's in-memory
 * state (X/Y field selections, colours, zoom, etc.) when the user temporarily
 * switches to the Table tab to tweak a divisor, so they don't have to
 * re-configure the chart on return. Updated props (colDivisors, rows) flow
 * through to the hidden component and are reflected immediately on return.
 */
export default function ResultsView({
  rows,
  fieldMeta,
  keyField,
  addressLabels = [],
  chartViews = [],
  onSaveView,
  colDivisors = {},
  onDivisorChange,
  colorSchemes = [],
  onSchemesChange,
}) {
  const [view, setView] = useState('table')

  return (
    <div>
      <div className="tab-bar" style={{ marginBottom: 8 }}>
        <button
          className={view === 'table' ? 'active' : ''}
          onClick={() => setView('table')}
        >
          Table
        </button>
        <button
          className={view === 'chart' ? 'active' : ''}
          onClick={() => setView('chart')}
        >
          Chart
        </button>
      </div>

      {/* Keep both mounted — hide with display:none to preserve chart state */}
      <div style={{ display: view === 'table' ? '' : 'none' }}>
        <ResultsTable
          rows={rows}
          fieldMeta={fieldMeta}
          keyField={keyField}
          colDivisors={colDivisors}
          onDivisorChange={onDivisorChange}
          addressLabels={addressLabels}
        />
      </div>
      <div style={{ display: view === 'chart' ? '' : 'none' }}>
        <ResultsChart
          rows={rows}
          fieldMeta={fieldMeta}
          keyField={keyField}
          colDivisors={colDivisors}
          onDivisorChange={onDivisorChange}
          chartViews={chartViews}
          onSaveView={onSaveView}
          colorSchemes={colorSchemes}
          onSchemesChange={onSchemesChange}
        />
      </div>
    </div>
  )
}
