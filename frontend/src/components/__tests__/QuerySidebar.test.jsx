import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../api/client.js', () => ({
  listQueries:   vi.fn(),
  importQueries: vi.fn(),
  getSettings:   vi.fn(),
  updateSettings: vi.fn(),
}))

import QuerySidebar from '../QuerySidebar.jsx'
import { listQueries, getSettings, updateSettings } from '../../api/client.js'

const QUERIES = [
  { id: 1, name: 'Alpha Query', category: 'Finance', last_run_at: null, last_row_count: null, is_builtin: false },
  { id: 2, name: 'Beta Query',  category: 'DeFi',    last_run_at: null, last_row_count: null, is_builtin: false },
]

describe('QuerySidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Pretend builtins already imported so we skip the fetch+import path
    getSettings.mockResolvedValue({ data: { builtin_imported: '1' } })
    updateSettings.mockResolvedValue({ ok: true, data: {} })
    listQueries.mockResolvedValue({ data: QUERIES })
  })

  it('renders a list of queries fetched on mount', async () => {
    render(<QuerySidebar onSelectQuery={() => {}} onNewQuery={() => {}} />)

    await waitFor(() => expect(screen.getByText('Alpha Query')).toBeInTheDocument())
    expect(screen.getByText('Beta Query')).toBeInTheDocument()
    // Category headings
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(screen.getByText('DeFi')).toBeInTheDocument()
  })

  it('search filter hides non-matching queries and shows matching ones', async () => {
    render(<QuerySidebar onSelectQuery={() => {}} onNewQuery={() => {}} />)

    await waitFor(() => expect(screen.getByText('Alpha Query')).toBeInTheDocument())

    const input = screen.getByPlaceholderText('Filter queries…')
    fireEvent.change(input, { target: { value: 'Alpha' } })

    expect(screen.getByText('Alpha Query')).toBeInTheDocument()
    expect(screen.queryByText('Beta Query')).not.toBeInTheDocument()
  })

  it('selecting a query calls onSelectQuery with the query object', async () => {
    const onSelectQuery = vi.fn()
    render(<QuerySidebar onSelectQuery={onSelectQuery} onNewQuery={() => {}} />)

    await waitFor(() => expect(screen.getByText('Alpha Query')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Alpha Query'))
    expect(onSelectQuery).toHaveBeenCalledWith(QUERIES[0])
  })

  it('clone button appears on hover and calls onCloneQuery', async () => {
    const onCloneQuery = vi.fn()
    render(<QuerySidebar onSelectQuery={() => {}} onNewQuery={() => {}} onCloneQuery={onCloneQuery} />)

    await waitFor(() => expect(screen.getByText('Alpha Query')).toBeInTheDocument())

    // The clone button should not be visible yet
    expect(screen.queryByTitle('Duplicate query')).not.toBeInTheDocument()

    // Hover over the sidebar item that contains Alpha Query
    const alphaItem = screen.getByText('Alpha Query').closest('.sidebar-item')
    fireEvent.mouseEnter(alphaItem)

    const cloneBtn = screen.getByTitle('Duplicate query')
    expect(cloneBtn).toBeInTheDocument()

    fireEvent.click(cloneBtn)
    expect(onCloneQuery).toHaveBeenCalledWith(QUERIES[0])
  })

  it('"New Query" button calls onNewQuery', async () => {
    const onNewQuery = vi.fn()
    render(<QuerySidebar onSelectQuery={() => {}} onNewQuery={onNewQuery} />)

    await waitFor(() => expect(screen.getByText('Alpha Query')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Query'))
    expect(onNewQuery).toHaveBeenCalledTimes(1)
  })
})
