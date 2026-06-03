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

const VALID_THEME = { bg: '#1a1a2e', textColor: '#c0c0c0', gridColor: '#3a3a5a', axisColor: '#5a5a8a' }

const SCHEMES = [
  { id: 1, name: 'Default', colors: ['#e94560', '#2196f3', '#4caf50'], theme: null, is_default: true },
  { id: 2, name: 'Ocean',   colors: ['#0099cc', '#005577', '#00ccaa'], theme: null, is_default: false },
]

const SCHEMES_WITH_THEMED = [
  ...SCHEMES,
  { id: 3, name: 'Branded', colors: ['#ff6b6b'], theme: VALID_THEME, is_default: false },
]

describe('ColorSchemeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listColorSchemes.mockResolvedValue({ data: SCHEMES, ok: true })
    createColorScheme.mockResolvedValue({ ok: true, data: { id: 99, name: 'New', colors: ['#aaaaaa'], theme: null, is_default: false } })
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
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    expect(screen.getByText('Ocean')).toBeInTheDocument()
  })

  it('shows "default" badge on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('does not render "Set default" button on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
    const setDefaultBtns = screen.getAllByText('Set default')
    expect(setDefaultBtns).toHaveLength(1)
  })

  it('does not render "Delete" button on the default scheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())
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

// ── Chart appearance (theme) ─────────────────────────────────────────────────

describe('ColorSchemeManager — chart appearance (theme)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listColorSchemes.mockResolvedValue({ data: SCHEMES, ok: true })
    createColorScheme.mockResolvedValue({ ok: true, data: { id: 99, name: 'X', colors: ['#aaa'], theme: null, is_default: false } })
    updateColorScheme.mockResolvedValue({ ok: true, data: {} })
    deleteColorScheme.mockResolvedValue({ ok: true })
    setDefaultScheme.mockResolvedValue({ ok: true, data: {} })
  })

  // ── Checkbox default state ───────────────────────────────────────────────────

  it('"Override chart appearance" checkbox is NOT checked by default in new-scheme editor', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    expect(checkbox).not.toBeChecked()
  })

  it('"Override chart appearance" checkbox is NOT checked when editing a scheme without a theme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[1]) // Ocean (theme: null)

    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    expect(checkbox).not.toBeChecked()
  })

  it('"Override chart appearance" checkbox IS checked when editing a scheme that already has a theme', async () => {
    listColorSchemes.mockResolvedValue({ data: SCHEMES_WITH_THEMED, ok: true })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Branded')).toBeInTheDocument())

    // Branded is the 3rd scheme; there are 2 Edit buttons for Default+Ocean (non-editable default has one)
    // Actually Default has Edit, Ocean has Edit, Branded has Edit — 3 Edit buttons total
    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[2]) // Branded

    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    expect(checkbox).toBeChecked()
  })

  // ── Theme picker visibility ──────────────────────────────────────────────────

  it('theme pickers are hidden when "Override chart appearance" is unchecked', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    expect(screen.queryByText('Background')).not.toBeInTheDocument()
    expect(screen.queryByText('Text & labels')).not.toBeInTheDocument()
    expect(screen.queryByText('Grid lines')).not.toBeInTheDocument()
    expect(screen.queryByText('Axis lines')).not.toBeInTheDocument()
  })

  it('checking "Override chart appearance" reveals all 4 theme pickers', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    fireEvent.click(checkbox)

    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(screen.getByText('Text & labels')).toBeInTheDocument()
    expect(screen.getByText('Grid lines')).toBeInTheDocument()
    expect(screen.getByText('Axis lines')).toBeInTheDocument()
  })

  it('unchecking "Override chart appearance" hides the theme pickers again', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    fireEvent.click(checkbox) // check
    expect(screen.getByText('Background')).toBeInTheDocument()

    fireEvent.click(checkbox) // uncheck
    expect(screen.queryByText('Background')).not.toBeInTheDocument()
  })

  it('theme pickers are visible by default when editing a scheme that has a theme', async () => {
    listColorSchemes.mockResolvedValue({ data: SCHEMES_WITH_THEMED, ok: true })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Branded')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[2])

    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(screen.getByText('Text & labels')).toBeInTheDocument()
    expect(screen.getByText('Grid lines')).toBeInTheDocument()
    expect(screen.getByText('Axis lines')).toBeInTheDocument()
  })

  // ── theme value saved/not saved ──────────────────────────────────────────────

  it('saving a new scheme without checking theme passes theme: null to createColorScheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))
    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), { target: { value: 'NoTheme' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(createColorScheme).toHaveBeenCalledWith(
        expect.objectContaining({ theme: null }),
      )
    )
  })

  it('saving a new scheme with theme checked passes a theme object to createColorScheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Default')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Scheme'))
    fireEvent.change(screen.getByPlaceholderText('Scheme name…'), { target: { value: 'WithTheme' } })

    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(createColorScheme).toHaveBeenCalledTimes(1)
      const [payload] = createColorScheme.mock.calls[0]
      expect(payload.theme).not.toBeNull()
      expect(typeof payload.theme).toBe('object')
      expect(payload.theme).toHaveProperty('bg')
      expect(payload.theme).toHaveProperty('textColor')
      expect(payload.theme).toHaveProperty('gridColor')
      expect(payload.theme).toHaveProperty('axisColor')
    })
  })

  it('saving an existing scheme (no theme) without checking theme passes theme: null to updateColorScheme', async () => {
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ocean')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[1])
    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(updateColorScheme).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ theme: null }),
      )
    )
  })

  it('unchecking theme on a scheme-with-theme and saving passes theme: null', async () => {
    listColorSchemes.mockResolvedValue({ data: SCHEMES_WITH_THEMED, ok: true })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Branded')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[2])
    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    // Checkbox should be pre-checked; uncheck it
    const checkbox = screen.getByRole('checkbox', { name: /override chart appearance/i })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(updateColorScheme).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ theme: null }),
      )
    )
  })

  it('saving a scheme-with-theme while checkbox stays checked passes theme object', async () => {
    listColorSchemes.mockResolvedValue({ data: SCHEMES_WITH_THEMED, ok: true })
    render(<ColorSchemeManager onClose={() => {}} onSchemesChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Branded')).toBeInTheDocument())

    const editBtns = screen.getAllByText('Edit')
    fireEvent.click(editBtns[2])
    await waitFor(() => screen.getByPlaceholderText('Scheme name…'))

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(updateColorScheme).toHaveBeenCalledTimes(1)
      const [, payload] = updateColorScheme.mock.calls[0]
      expect(payload.theme).not.toBeNull()
      expect(typeof payload.theme).toBe('object')
    })
  })
})
