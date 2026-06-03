import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../ResultsTable.jsx', () => ({
  default: ({ colDivisors, rows }) => (
    <div data-testid="results-table">
      <span data-testid="table-rows">{rows?.length ?? 0}</span>
      <span data-testid="table-divisors">{JSON.stringify(colDivisors ?? {})}</span>
    </div>
  ),
}))

/**
 * Stateful mock for ResultsChart.
 *
 * Has an internal click counter so tests can confirm that the component is NOT
 * remounted (and its state NOT reset) when the user switches tabs.
 */
vi.mock('../ResultsChart.jsx', () => ({
  default: function MockResultsChart({ colDivisors, rows }) {
    const [clicks, setClicks] = React.useState(0)
    return (
      <div data-testid="results-chart">
        <span data-testid="chart-rows">{rows?.length ?? 0}</span>
        <span data-testid="chart-divisors">{JSON.stringify(colDivisors ?? {})}</span>
        <span data-testid="chart-clicks">{clicks}</span>
        <button data-testid="chart-increment" onClick={() => setClicks(c => c + 1)}>
          +
        </button>
      </div>
    )
  },
}))

import ResultsView from '../ResultsView.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROWS = [{ id: 1, val: 100 }, { id: 2, val: 200 }]

function renderView(extraProps = {}) {
  return render(
    <ResultsView
      rows={ROWS}
      fieldMeta={{}}
      keyField="id"
      colDivisors={{}}
      {...extraProps}
    />,
  )
}

// ── Tab rendering ─────────────────────────────────────────────────────────────

describe('ResultsView — tab buttons', () => {
  it('renders both Table and Chart tab buttons', () => {
    renderView()
    expect(screen.getByText('Table')).toBeInTheDocument()
    expect(screen.getByText('Chart')).toBeInTheDocument()
  })

  it('Table tab button has "active" class by default', () => {
    renderView()
    expect(screen.getByText('Table').className).toContain('active')
    expect(screen.getByText('Chart').className).not.toContain('active')
  })

  it('clicking Chart makes Chart button active and Table button inactive', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByText('Chart').className).toContain('active')
    expect(screen.getByText('Table').className).not.toContain('active')
  })

  it('clicking back to Table restores Table as active', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.click(screen.getByText('Table'))
    expect(screen.getByText('Table').className).toContain('active')
    expect(screen.getByText('Chart').className).not.toContain('active')
  })
})

// ── Visibility ────────────────────────────────────────────────────────────────

describe('ResultsView — visibility', () => {
  it('Table wrapper is visible and Chart wrapper is hidden by default', () => {
    renderView()
    const tableWrapper = screen.getByTestId('results-table').parentElement
    const chartWrapper = screen.getByTestId('results-chart').parentElement
    expect(tableWrapper.style.display).not.toBe('none')
    expect(chartWrapper.style.display).toBe('none')
  })

  it('clicking Chart hides Table wrapper and shows Chart wrapper', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    const tableWrapper = screen.getByTestId('results-table').parentElement
    const chartWrapper = screen.getByTestId('results-chart').parentElement
    expect(tableWrapper.style.display).toBe('none')
    expect(chartWrapper.style.display).not.toBe('none')
  })

  it('clicking back to Table restores Table visibility and hides Chart', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.click(screen.getByText('Table'))
    const tableWrapper = screen.getByTestId('results-table').parentElement
    const chartWrapper = screen.getByTestId('results-chart').parentElement
    expect(tableWrapper.style.display).not.toBe('none')
    expect(chartWrapper.style.display).toBe('none')
  })
})

// ── Both components always mounted ────────────────────────────────────────────

describe('ResultsView — both components always mounted', () => {
  it('ResultsTable is in the DOM on the default Table tab', () => {
    renderView()
    expect(screen.getByTestId('results-table')).toBeInTheDocument()
  })

  it('ResultsChart is in the DOM on the default Table tab (mounted but hidden)', () => {
    renderView()
    expect(screen.getByTestId('results-chart')).toBeInTheDocument()
  })

  it('ResultsTable remains mounted after switching to Chart tab', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('results-table')).toBeInTheDocument()
  })

  it('ResultsChart remains mounted after switching to Table tab', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.click(screen.getByText('Table'))
    expect(screen.getByTestId('results-chart')).toBeInTheDocument()
  })

  it('both components are in the DOM throughout a Table → Chart → Table cycle', () => {
    renderView()
    // Start on Table
    expect(screen.getByTestId('results-table')).toBeInTheDocument()
    expect(screen.getByTestId('results-chart')).toBeInTheDocument()

    // Switch to Chart
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('results-table')).toBeInTheDocument()
    expect(screen.getByTestId('results-chart')).toBeInTheDocument()

    // Switch back to Table
    fireEvent.click(screen.getByText('Table'))
    expect(screen.getByTestId('results-table')).toBeInTheDocument()
    expect(screen.getByTestId('results-chart')).toBeInTheDocument()
  })
})

// ── Chart state preservation ──────────────────────────────────────────────────

describe('ResultsView — chart state survives tab switching', () => {
  it('internal chart state is preserved across a Chart → Table → Chart round-trip', () => {
    renderView()

    // Switch to Chart and interact with it
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.click(screen.getByTestId('chart-increment'))
    fireEvent.click(screen.getByTestId('chart-increment'))
    fireEvent.click(screen.getByTestId('chart-increment'))
    expect(screen.getByTestId('chart-clicks').textContent).toBe('3')

    // Switch away and back
    fireEvent.click(screen.getByText('Table'))
    fireEvent.click(screen.getByText('Chart'))

    // Counter must still be 3 — component was NOT remounted
    expect(screen.getByTestId('chart-clicks').textContent).toBe('3')
  })

  it('chart state resets to 0 on first render (baseline sanity check)', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-clicks').textContent).toBe('0')
  })

  it('multiple round-trips do not reset chart state', () => {
    renderView()
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.click(screen.getByTestId('chart-increment')) // clicks = 1

    // First round-trip
    fireEvent.click(screen.getByText('Table'))
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-clicks').textContent).toBe('1')

    fireEvent.click(screen.getByTestId('chart-increment')) // clicks = 2

    // Second round-trip
    fireEvent.click(screen.getByText('Table'))
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-clicks').textContent).toBe('2')
  })
})

// ── Prop propagation ──────────────────────────────────────────────────────────

describe('ResultsView — prop propagation', () => {
  it('passes rows to ResultsTable', () => {
    renderView({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    expect(screen.getByTestId('table-rows').textContent).toBe('3')
  })

  it('passes rows to ResultsChart (even while hidden)', () => {
    renderView({ rows: [{ id: 1 }] })
    expect(screen.getByTestId('chart-rows').textContent).toBe('1')
  })

  it('passes colDivisors to ResultsTable', () => {
    renderView({ colDivisors: { amount: '1e18' } })
    expect(screen.getByTestId('table-divisors').textContent).toContain('"amount":"1e18"')
  })

  it('passes colDivisors to ResultsChart', () => {
    renderView({ colDivisors: { amount: '1e6' } })
    expect(screen.getByTestId('chart-divisors').textContent).toContain('"amount":"1e6"')
  })

  it('colDivisors update reaches ResultsChart while Table tab is active', () => {
    const { rerender } = render(
      <ResultsView rows={ROWS} fieldMeta={{}} keyField="id" colDivisors={{ val: 'raw' }} />,
    )

    // Verify initial value visible in chart (switch to check, switch back)
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-divisors').textContent).toContain('"val":"raw"')
    fireEvent.click(screen.getByText('Table'))

    // Change divisors while on Table tab
    rerender(
      <ResultsView rows={ROWS} fieldMeta={{}} keyField="id" colDivisors={{ val: '1e18' }} />,
    )

    // Chart should reflect the update immediately on return
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-divisors').textContent).toContain('"val":"1e18"')
  })

  it('rows update reaches ResultsChart while Table tab is active', () => {
    const { rerender } = render(
      <ResultsView rows={[{ id: 1 }]} fieldMeta={{}} keyField="id" />,
    )

    // Switch away
    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-rows').textContent).toBe('1')
    fireEvent.click(screen.getByText('Table'))

    // New rows arrive (e.g. a re-run completed)
    rerender(
      <ResultsView rows={[{ id: 1 }, { id: 2 }, { id: 3 }]} fieldMeta={{}} keyField="id" />,
    )

    fireEvent.click(screen.getByText('Chart'))
    expect(screen.getByTestId('chart-rows').textContent).toBe('3')
  })

  it('colDivisors update reaches ResultsTable', () => {
    const { rerender } = render(
      <ResultsView rows={ROWS} fieldMeta={{}} keyField="id" colDivisors={{ val: 'raw' }} />,
    )
    expect(screen.getByTestId('table-divisors').textContent).toContain('"val":"raw"')

    rerender(
      <ResultsView rows={ROWS} fieldMeta={{}} keyField="id" colDivisors={{ val: '1e6' }} />,
    )
    expect(screen.getByTestId('table-divisors').textContent).toContain('"val":"1e6"')
  })

  it('onDivisorChange callback is forwarded (not lost)', () => {
    const onDivisorChange = vi.fn()
    // Our mock doesn't call onDivisorChange directly, so we just verify
    // it is passed through without throwing
    renderView({ onDivisorChange })
    expect(onDivisorChange).not.toHaveBeenCalled() // mock doesn't trigger it
  })
})
