import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../api/client.js', () => ({
  listColorSchemes:  vi.fn(),
  createColorScheme: vi.fn(),
  updateColorScheme: vi.fn(),
  deleteColorScheme: vi.fn(),
  setDefaultScheme:  vi.fn(),
}))

// @uiw/react-color's Sketch picker is a canvas-heavy component; stub it out
vi.mock('@uiw/react-color', () => ({
  Sketch: ({ onChange }) => (
    <button data-testid="color-picker-sketch" onClick={() => onChange({ hex: '#aabbcc' })}>
      PickerStub
    </button>
  ),
}))

import ColorSchemeManager from '../ColorSchemeManager.jsx'
import {
  listColorSchemes, createColorScheme, updateColorScheme,
  deleteColorScheme, setDefaultScheme,
} from '../../api/client.js'

const SCHEMES = [
  { id: 1, name: 'Default', colors: ['#e94560', '#2196f3', '#4caf50'], is_default: true },
  { id: 2, name: 'Ocean',   colors: ['#0099cc', '#005577', '#00ccaa'], is_default: false },
]

describe('ColorSchemeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listColorSchemes.mockResolvedValue({ data: SCHEMES, ok: true })
    createColorScheme.mockResolvedValue({ ok: true, data: { id: 99, name: 'New', colors: ['#aaaaaa'], is_default: false } })
    updateColorScheme.mockResolvedValue({ ok: true, data: {} })
    deleteColorScheme.mockResolvedValue({ ok: true })
    setDefaultScheme.mockResolvedValue({ ok: true, data: {} })
  })

  // ── Initial render ──────────────────────────────────────────────────────────

  it('renders the modal title', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    expect(screen.getByText('Color Schemes')).toBeInTheDocument()
  })

  it('shows loading state then renders scheme list', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    // After data loads, scheme names appear
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    expect(screen.getByText('Ocean')).toBeInTheDocument()
  })

  it('shows "default" badge on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    // The badge text
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('does not render "Set default" button on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    // Only one "Set default" button — for Ocean (not Default)
    const setDefaultBtns = screen.getAllByText('Set default')
    expect(setDefaultBtns).toHaveLength(1)
  })

  it('does not render "Delete" button on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    // Only one "Delete" button — for Ocean
    const deleteBtns = screen.getAllByText('Delete')
    expect(deleteBtns).toHaveLength(1)
  })

  // ── Set default ─────────────────────────────────────────────────────────────

  it('clicking "Set default" on Ocean calls setDefaultScheme(2)', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Set default'))

    await waitFor(() => expect(setDefaultScheme).toHaveBeenCalledWith(2))
  })

  it('calls onSchemesChange after successful set-default', async () => {
    const onSchemesChange = vi.fn()
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={onSchemesChange} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Set default'))

    await waitFor(() => expect(onSchemesChange).toHaveBeenCalledTimes(1))
  })

  // ── Delete ──────────────────────────────────────────────────────────────────

  it('clicking "Delete" on Ocean calls deleteColorScheme(2)', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(deleteColorScheme).toHaveBeenCalledWith(2))
  })

  it('calls onSchemesChange after successful delete', async () => {
    const onSchemesChange = vi.fn()
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={onSchemesChange} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(onSchemesChange).toHaveBeenCalledTimes(1))
  })

  it('shows error banner when delete fails', async () => {
    deleteColorScheme.mockResolvedValue({ ok: false, data: { message: 'Cannot delete the only color scheme' } })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() =>
      expect(screen.getByText('Cannot delete the only color scheme')).toBeInTheDocument()
    )
  })

  // ── Edit (inline SchemeEditor) ───────────────────────────────────────────────

  it('clicking "Edit" on Ocean opens the inline editor with its name pre-filled', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    // Both schemes have "Edit" buttons; click the second one (Ocean)
    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[1])

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Scheme name…')
      expect(nameInput.value).toBe('Ocean')
    })
  })

  it('clicking "Cancel" in the editor closes the editor', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[1])

    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Scheme name…')).not.toBeInTheDocument()
    )
  })

  it('saving edited scheme calls updateColorScheme with id and new values', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[1])

    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), {
      target: { value: 'Ocean Blue' },
    })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(updateColorScheme).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ name: 'Ocean Blue' }),
      )
    )
  })

  // ── New Scheme ───────────────────────────────────────────────────────────────

  it('clicking "+ New Scheme" shows the SchemeEditor form', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    expect(screen.getByPlaceholderText('Scheme name…')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('creating a new scheme calls createColorScheme with name and colors', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), {
      target: { value: 'Sunset' },
    })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(createColorScheme).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sunset' }),
      )
    )
  })

  it('Save button is disabled while name is empty', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    // Name is blank by default in the new-scheme form
    const saveBtn = screen.getByText('Save')
    expect(saveBtn).toBeDisabled()
  })

  it('calls onSchemesChange after creating a new scheme', async () => {
    const onSchemesChange = vi.fn()
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={onSchemesChange} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))
    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), {
      target: { value: 'Dusk' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onSchemesChange).toHaveBeenCalledTimes(1))
  })

  it('shows error banner when createColorScheme fails', async () => {
    createColorScheme.mockResolvedValue({ ok: false, data: { message: 'A scheme with that name already exists' } })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))
    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), {
      target: { value: 'Default' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByText('A scheme with that name already exists')).toBeInTheDocument()
    )
  })

  // ── Close ────────────────────────────────────────────────────────────────────

  it('clicking the × button calls onClose', async () => {
    const onClose = vi.fn()
    render(<ColorSchemeManager onClose={onClose} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    // The × header button
    const closeButtons = screen.getAllByText('×')
    fireEvent.click(closeButtons[0])

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking "Close" footer button calls onClose', async () => {
    const onClose = vi.fn()
    render(<ColorSchemeManager onClose={onClose} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
