import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../api/client.js', () => ({
  listRuns:  vi.fn(),
  getRun:    vi.fn(),
  deleteRun: vi.fn(),
  patchRun:  vi.fn(),
}))

import HistoryDrawer from '../HistoryDrawer.jsx'
import { listRuns, getRun, deleteRun, patchRun } from '../../api/client.js'

const RUNS = [
  {
    id: 10,
    ran_at: new Date('2024-01-15T12:00:00Z').toISOString(),
    row_count: 42,
    page_count: 1,
    duration_ms: 350,
    error_type: null,
    notes: null,
    start_date: null,
    end_date: null,
  },
  {
    id: 11,
    ran_at: new Date('2024-01-16T08:30:00Z').toISOString(),
    row_count: 100,
    page_count: 2,
    duration_ms: 810,
    error_type: null,
    notes: 'some existing note',
    start_date: null,
    end_date: null,
  },
]

describe('HistoryDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRuns.mockResolvedValue({ data: RUNS })
    getRun.mockResolvedValue({ data: RUNS[0] })
    deleteRun.mockResolvedValue({ ok: true })
    patchRun.mockResolvedValue({ ok: true })
  })

  it('renders nothing when open=false', () => {
    render(<HistoryDrawer queryId={1} open={false} onClose={() => {}} />)
    expect(screen.queryByText('Run History')).not.toBeInTheDocument()
  })

  it('renders run items when open=true and queryId is set', async () => {
    render(<HistoryDrawer queryId={1} open={true} onClose={() => {}} />)

    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(1, 50, 0))
    expect(screen.getByText('Run #10')).toBeInTheDocument()
    expect(screen.getByText('Run #11')).toBeInTheDocument()
  })

  it('clicking the note area renders a textarea', async () => {
    render(<HistoryDrawer queryId={1} open={true} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Run #10')).toBeInTheDocument())

    // Run #10 has no notes, shows 'Add note…'
    const noteArea = screen.getAllByText('Add note…')[0]
    fireEvent.click(noteArea)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('typing in textarea and clicking Save calls patchRun', async () => {
    render(<HistoryDrawer queryId={1} open={true} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Run #10')).toBeInTheDocument())

    // Click the note placeholder for run #10
    const noteArea = screen.getAllByText('Add note…')[0]
    fireEvent.click(noteArea)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'my new note' } })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(patchRun).toHaveBeenCalledWith(10, { notes: 'my new note' })
    )
  })

  it('after save, the note text is displayed instead of a textarea', async () => {
    render(<HistoryDrawer queryId={1} open={true} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Run #10')).toBeInTheDocument())

    const noteArea = screen.getAllByText('Add note…')[0]
    fireEvent.click(noteArea)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'saved note text' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(patchRun).toHaveBeenCalled())

    // Textarea should be gone, note text visible
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('saved note text')).toBeInTheDocument()
  })

  it('clicking Cancel discards changes', async () => {
    render(<HistoryDrawer queryId={1} open={true} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Run #10')).toBeInTheDocument())

    const noteArea = screen.getAllByText('Add note…')[0]
    fireEvent.click(noteArea)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'discarded text' } })
    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('discarded text')).not.toBeInTheDocument()
    expect(patchRun).not.toHaveBeenCalled()
  })
})
