import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ─── mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api/client.js', () => ({
  listQueries: vi.fn(),
  createRun:   vi.fn(),
}))

// ECharts tries to measure DOM nodes — stub it out
vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}))

// ResizeObserver is not in jsdom
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import MultiQueryChart from '../MultiQueryChart.jsx'
import { listQueries, createRun } from '../../api/client.js'

// ─── fixtures ──────────────────────────────────────────────────────────────────

const DAY_JAN15 = 1705276800
const DAY_JAN16 = 1705363200

const QUERIES = [
  { id: 1, name: 'Revenue Query' },
  { id: 2, name: 'Cost Query' },
]

const RUN_RESULT_A = {
  rows: [
    { timestamp: DAY_JAN15, revenue: 100 },
    { timestamp: DAY_JAN16, revenue: 200 },
  ],
}

const RUN_RESULT_B = {
  rows: [
    { timestamp: DAY_JAN15, cost: 50 },
    { timestamp: DAY_JAN16, cost: 80 },
  ],
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  listQueries.mockResolvedValue({ data: QUERIES })
  createRun.mockResolvedValue({ data: RUN_RESULT_A })
})

// ─── initial render ───────────────────────────────────────────────────────────

describe('MultiQueryChart — initial render', () => {
  it('renders the Add Dataset dropdown', async () => {
    render(<MultiQueryChart />)
    // Dropdown appears immediately (or after queries load)
    await waitFor(() => expect(screen.getByText('+ Add Dataset…')).toBeInTheDocument())
  })

  it('populates the dataset dropdown with saved queries', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Cost Query' })).toBeInTheDocument()
  })

  it('shows empty-state message when no datasets added', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByText(/Add one or more datasets/i)).toBeInTheDocument())
  })

  it('"+ Add Series" button is disabled until a dataset is added', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Add Series' })).toBeDisabled())
  })
})

// ─── adding a dataset ─────────────────────────────────────────────────────────

describe('MultiQueryChart — adding a dataset', () => {
  it('selecting a query from the dropdown adds a dataset row', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    const select = screen.getAllByRole('combobox')[0]
    fireEvent.change(select, { target: { value: '1' } })

    // After adding, "Revenue Query" appears in: dropdown option + dataset row span
    // The dataset section heading confirms the row was added
    expect(screen.getByText('Datasets')).toBeInTheDocument()
    expect(screen.getAllByText('Revenue Query').length).toBeGreaterThanOrEqual(2)
  })

  it('shows a Run button after adding a dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(
      screen.getAllByRole('combobox')[0],
      { target: { value: '1' } }
    )

    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('shows a remove (✕) button after adding a dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })

    // There are two ✕ buttons: one in the dataset row, one in potential series — just confirm at least one
    const removes = screen.getAllByRole('button', { name: '✕' })
    expect(removes.length).toBeGreaterThanOrEqual(1)
  })

  it('enables "+ Add Series" after a dataset is added', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })

    expect(screen.getByRole('button', { name: '+ Add Series' })).not.toBeDisabled()
  })
})

// ─── running a dataset ────────────────────────────────────────────────────────

describe('MultiQueryChart — running a dataset', () => {
  it('calls createRun with the correct query_id', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(createRun).toHaveBeenCalledWith({ query_id: 1 }))
  })

  it('shows row count after a successful run', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByText(/2 rows/)).toBeInTheDocument())
  })

  it('shows error badge when run fails', async () => {
    createRun.mockResolvedValue({ data: { error_message: 'timeout' } })

    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByText(/timeout/)).toBeInTheDocument())
  })

  it('auto-detects xField as "timestamp" when present in rows', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByText(/2 rows/)).toBeInTheDocument())

    // The X field selector should be set to 'timestamp'
    const xSelects = screen.getAllByRole('combobox')
    const xSelect = xSelects.find(s => s.value === 'timestamp')
    expect(xSelect).toBeDefined()
  })
})

// ─── removing a dataset ───────────────────────────────────────────────────────

describe('MultiQueryChart — removing a dataset', () => {
  it('removes the dataset row when ✕ is clicked', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    // Dataset section heading confirms the row exists
    expect(screen.getByText('Datasets')).toBeInTheDocument()

    // Click the dataset-level remove button
    const removeBtn = screen.getAllByRole('button', { name: '✕' })[0]
    fireEvent.click(removeBtn)

    // After removal the Datasets section heading disappears (no datasets left)
    expect(screen.queryByText('Datasets')).not.toBeInTheDocument()
  })
})

// ─── series management ────────────────────────────────────────────────────────

describe('MultiQueryChart — series management', () => {
  it('adds a series row when "+ Add Series" is clicked', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Series' }))

    // Series section heading appears
    expect(screen.getByText('Series')).toBeInTheDocument()
  })

  it('shows left Y / right Y axis options per series', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Series' }))

    expect(screen.getByRole('option', { name: 'left Y' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'right Y' })).toBeInTheDocument()
  })

  it('shows chart type options per series', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Series' }))

    expect(screen.getByRole('option', { name: 'line' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'bar' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'area' })).toBeInTheDocument()
  })

  it('removes a series row when its ✕ is clicked', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Series' }))

    expect(screen.getByText('Series')).toBeInTheDocument()

    // The last ✕ button is the series one (dataset ✕ is first)
    const removeBtns = screen.getAllByRole('button', { name: '✕' })
    fireEvent.click(removeBtns[removeBtns.length - 1])

    expect(screen.queryByText('Series')).not.toBeInTheDocument()
  })
})

// ─── chart controls ───────────────────────────────────────────────────────────

describe('MultiQueryChart — chart controls', () => {
  it('renders "Connect nulls" checkbox', async () => {
    render(<MultiQueryChart />)
    expect(screen.getByLabelText(/connect nulls/i)).toBeInTheDocument()
  })

  it('renders "Legend" checkbox', async () => {
    render(<MultiQueryChart />)
    expect(screen.getByLabelText(/legend/i)).toBeInTheDocument()
  })

  it('"Connect nulls" checkbox toggles', async () => {
    render(<MultiQueryChart />)
    const cb = screen.getByLabelText(/connect nulls/i)
    expect(cb.checked).toBe(false)
    fireEvent.click(cb)
    expect(cb.checked).toBe(true)
  })
})

// ─── two datasets — run all ───────────────────────────────────────────────────

describe('MultiQueryChart — two datasets', () => {
  beforeEach(() => {
    // First call returns A, second returns B
    createRun
      .mockResolvedValueOnce({ data: RUN_RESULT_A })
      .mockResolvedValueOnce({ data: RUN_RESULT_B })
  })

  it('"Run All" button appears when two datasets are added', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    const addSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(addSelect, { target: { value: '1' } })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2' } })

    expect(screen.getByRole('button', { name: 'Run All' })).toBeInTheDocument()
  })

  it('"Run All" calls createRun for each dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Run All' }))

    await waitFor(() => expect(createRun).toHaveBeenCalledTimes(2))
  })
})

// ─── dataset config controls ──────────────────────────────────────────────────

describe('MultiQueryChart — dataset config controls', () => {
  it('shows GroupBy selector per dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })

    // GroupBy options
    expect(screen.getByRole('option', { name: 'day' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'week' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'month' })).toBeInTheDocument()
  })

  it('shows Aggregation selector per dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })

    expect(screen.getByRole('option', { name: 'sum' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'avg' })).toBeInTheDocument()
  })

  it('shows Mode (raw/cumulative) selector per dataset', async () => {
    render(<MultiQueryChart />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue Query' })).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })

    expect(screen.getByRole('option', { name: 'raw' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'cumulative' })).toBeInTheDocument()
  })
})
