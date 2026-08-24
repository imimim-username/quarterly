/**
 * Tests for FilenameModal and its integration into the ReportBuilder
 * generate-PNG flow.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../api/client.js', () => ({
  listQueries:             vi.fn().mockResolvedValue({ data: [] }),
  listColorSchemes:        vi.fn().mockResolvedValue({ data: [] }),
  createReport:            vi.fn(),
  updateReport:            vi.fn(),
  deleteReport:            vi.fn(),
  bulkSaveReportInstances: vi.fn(),
}))

vi.mock('../ReportThemeEditor.jsx', () => ({
  default: () => <div data-testid="theme-editor" />,
}))

// Expose a `generate()` method via the forwarded ref.
vi.mock('../ReportInstanceCard.jsx', () => {
  const React = require('react')
  const Comp = React.forwardRef(({ instance }, ref) => {
    React.useImperativeHandle(ref, () => ({
      generate: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/png;base64,abc',
        filename: instance?.label ? `${instance.label}.png` : 'chart.png',
      }),
    }))
    return <div data-testid={`card-${instance?._tempId}`} />
  })
  Comp.displayName = 'ReportInstanceCard'
  return { default: Comp, defaultInstanceConfig: () => ({}) }
})

vi.mock('../../utils/zipBuilder.js', () => ({
  buildZipBytes: vi.fn(() => new Uint8Array([0x50, 0x4b])),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import ReportBuilder from '../ReportBuilder.jsx'

function makeReport(overrides = {}) {
  return {
    id: 1,
    name: 'Test Report',
    description: '',
    config: {},
    instances: [
      {
        id: 10,
        _tempId: 'tmp_test_1',
        query_id: 1,
        label: 'My Chart',
        position: 0,
        config: {},
        query: { id: 1, name: 'My Query', category: 'Test' },
      },
    ],
    ...overrides,
  }
}

const baseProps = {
  startDate: new Date('2026-01-01'),
  endDate:   new Date('2026-06-30'),
  onSave:    vi.fn(),
  onDelete:  vi.fn(),
}

// showDirectoryPicker absent → ZIP fallback (simpler to test)
beforeEach(() => {
  delete window.showDirectoryPicker
  window.URL.createObjectURL = vi.fn(() => 'blob:test')
  window.URL.revokeObjectURL = vi.fn()
  // Silence the anchor.click download trigger
  HTMLAnchorElement.prototype.click = vi.fn()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Selectors ────────────────────────────────────────────────────────────────

/** The modal card div (child of backdrop). */
function getModalCard() {
  return document.querySelector('[style*="border-radius: 10px"]')
}

/** The modal's filename input specifically (has spellcheck=false). */
function getModalInput() {
  return document.querySelector('input[spellcheck="false"]')
}

/** Save button inside the modal card. */
function getModalSaveBtn() {
  const card = getModalCard()
  return card ? within(card).getByRole('button', { name: 'Save' }) : null
}

/** Cancel all button inside the modal card. */
function getModalCancelBtn() {
  const card = getModalCard()
  return card ? within(card).getByRole('button', { name: 'Cancel all' }) : null
}

/** Backdrop overlay div (position fixed, zIndex 2000). */
function getBackdrop() {
  return document.querySelector('[style*="z-index: 2000"]')
}

// ─── Modal appears and is pre-filled ─────────────────────────────────────────

describe('FilenameModal — rendered via generate flow', () => {
  it('appears after generate starts with the proposed filename pre-filled', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => expect(screen.getByText('💾 Name this PNG')).toBeInTheDocument())

    // The mock generate() returns `${label}.png` = 'My Chart.png'
    expect(getModalInput()).toHaveValue('My Chart.png')
  })

  it('Save button inside modal is disabled when input is empty', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    fireEvent.change(getModalInput(), { target: { value: '' } })
    expect(getModalSaveBtn()).toBeDisabled()
  })

  it('Save button inside modal is enabled when input has a value', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))
    expect(getModalSaveBtn()).not.toBeDisabled()
  })

  it('clicking modal Save closes the modal and proceeds to build ZIP', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))
    fireEvent.click(getModalSaveBtn())

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })

    // After the loop finishes, the generate button re-enables
    await waitFor(() => {
      expect(screen.getByText('⬇ Generate PNGs')).not.toBeDisabled()
    }, { timeout: 3000 })
  })

  it('pressing Enter saves with the current filename', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    const input = getModalInput()
    fireEvent.change(input, { target: { value: 'my-custom-name.png' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })
  })

  it('pressing Escape cancels the whole operation', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    fireEvent.keyDown(getModalInput(), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('⬇ Generate PNGs')).not.toBeDisabled()
    })
  })

  it('"Cancel all" button closes modal and aborts the generate loop', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))
    fireEvent.click(getModalCancelBtn())

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('⬇ Generate PNGs')).not.toBeDisabled()
    })
  })

  it('clicking the backdrop (outside the card) cancels the operation', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    const backdrop = getBackdrop()
    expect(backdrop).not.toBeNull()

    // Simulate a click where target === currentTarget (i.e., on the backdrop itself,
    // not a child element). jsdom won't naturally set target this way for fireEvent,
    // so we call the handler as it would run in the browser by using Object.defineProperty.
    // Simpler approach: directly invoke the onClick as if target === currentTarget.
    const clickEvent = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEvent, 'target', { value: backdrop })
    Object.defineProperty(clickEvent, 'currentTarget', { value: backdrop })
    backdrop.dispatchEvent(clickEvent)

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('⬇ Generate PNGs')).not.toBeDisabled()
    })
  })
})

// ─── .png extension enforcement ──────────────────────────────────────────────

describe('FilenameModal — .png extension enforcement', () => {
  it('appends .png when user removes the extension before saving', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    fireEvent.change(getModalInput(), { target: { value: 'my-chart' } })
    fireEvent.click(getModalSaveBtn())

    await waitFor(() => {
      expect(buildZipBytes).toHaveBeenCalled()
    }, { timeout: 3000 })

    const callArg = buildZipBytes.mock.calls[0][0]
    expect(callArg[0].name).toBe('my-chart.png')
  })

  it('does not double-append .png when extension is already present', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    fireEvent.change(getModalInput(), { target: { value: 'already-has-it.png' } })
    fireEvent.click(getModalSaveBtn())

    await waitFor(() => {
      expect(buildZipBytes).toHaveBeenCalled()
    }, { timeout: 3000 })

    const callArg = buildZipBytes.mock.calls[0][0]
    expect(callArg[0].name).toBe('already-has-it.png')
  })

  it('extension check is case-insensitive — .PNG is not double-extended', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    fireEvent.change(getModalInput(), { target: { value: 'UPPERCASE.PNG' } })
    fireEvent.click(getModalSaveBtn())

    await waitFor(() => {
      expect(buildZipBytes).toHaveBeenCalled()
    }, { timeout: 3000 })

    const callArg = buildZipBytes.mock.calls[0][0]
    // Should NOT become 'UPPERCASE.PNG.png'
    expect(callArg[0].name).toBe('UPPERCASE.PNG')
  })
})

// ─── Toolbar Cancel while modal is open ───────────────────────────────────────

describe('FilenameModal — toolbar Cancel while modal is open', () => {
  it('toolbar Cancel dismisses the modal immediately without further user input', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))

    // Click the small ✕ Cancel button in the action bar (not the modal)
    fireEvent.click(screen.getByText('✕ Cancel'))

    await waitFor(() => {
      expect(screen.queryByText('💾 Name this PNG')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('⬇ Generate PNGs')).not.toBeDisabled()
    })
  })

  it('status shows (cancelling…) after toolbar Cancel', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))

    await waitFor(() => screen.getByText('💾 Name this PNG'))
    fireEvent.click(screen.getByText('✕ Cancel'))

    await waitFor(() => {
      expect(screen.getByText(/cancelling/i)).toBeInTheDocument()
    })
  })
})
