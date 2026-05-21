import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getScrollElement, estimateSize }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * estimateSize(i),
      size: estimateSize(i),
      key: i,
    })),
    getTotalSize: () => count * estimateSize(0),
  }),
}))

vi.mock('../../utils/addressLabels.js', () => ({
  buildAddressMap: () => ({}),
  resolveAddress: (_map, addr) => null,
}))

import ResultsTable from '../ResultsTable.jsx'

const ROWS = [
  { id: 1, name: 'Alice', amount: 100 },
  { id: 2, name: 'Bob',   amount: 200 },
  { id: 3, name: 'Carol', amount: 300 },
]

describe('ResultsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('renders column headers and row data', () => {
    render(<ResultsTable rows={ROWS} />)

    // Headers — use getAllByText because 'id' also appears in the stats bar label
    expect(screen.getAllByText('id').length).toBeGreaterThan(0)
    expect(screen.getAllByText('name').length).toBeGreaterThan(0)
    expect(screen.getAllByText('amount').length).toBeGreaterThan(0)

    // Row data
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
  })

  it('full-text search filters rows to show only matching', () => {
    render(<ResultsTable rows={ROWS} />)

    const searchInput = screen.getByPlaceholderText('Search rows…')
    fireEvent.change(searchInput, { target: { value: 'Alice' } })

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.queryByText('Carol')).not.toBeInTheDocument()
  })

  it('column visibility: clicking ⚙ opens panel; hiding a column removes it from the table', () => {
    render(<ResultsTable rows={ROWS} />)

    // Open column visibility panel
    fireEvent.click(screen.getByTitle('Column visibility'))

    // Uncheck the 'name' column
    const nameCheckbox = screen.getByRole('checkbox', { name: 'name' })
    expect(nameCheckbox).toBeChecked()
    fireEvent.click(nameCheckbox)

    // name column header should be gone
    expect(screen.queryByRole('columnheader', { name: /^name$/ })).not.toBeInTheDocument()
    // Alice text should not appear
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('stats bar shows sum/avg/min/max for numeric column', () => {
    const { container } = render(<ResultsTable rows={ROWS} />)

    // sum = 600, avg = 200, min = 100, max = 300
    // Stats bar uses fmtNum. The text is split across sibling nodes inside a <div>,
    // so we inspect the container's full textContent.
    const statsBar = container.querySelector('[style*="overflow-x: auto"][style*="padding: 6px"]')
    expect(statsBar).toBeTruthy()
    const statsText = statsBar.textContent
    expect(statsText).toMatch(/amount/)
    // Σ, avg, min, max labels appear in the bar
    expect(statsText).toMatch(/Σ/)
    expect(statsText).toMatch(/avg/)
    expect(statsText).toMatch(/min/)
    expect(statsText).toMatch(/max/)
  })

  it('Copy ▾ menu appears when clicked; "Markdown" copies markdown table format', async () => {
    render(<ResultsTable rows={ROWS} />)

    // Click the Copy ▾ button
    fireEvent.click(screen.getByText('Copy ▾'))

    // Markdown option should appear
    const markdownOption = screen.getByText('Markdown')
    expect(markdownOption).toBeInTheDocument()

    fireEvent.click(markdownOption)

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())

    const written = navigator.clipboard.writeText.mock.calls[0][0]
    expect(written).toMatch(/\| id \| name \| amount \|/)
    expect(written).toMatch(/----/)
    expect(written).toMatch(/Alice/)
  })
})
