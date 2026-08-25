/**
 * Tests for PngExportModal and its integration into the ReportBuilder
 * generate-PNG flow.
 *
 * The new flow:
 *   1. Click "⬇ Generate PNGs" → PngExportModal opens
 *   2. User selects charts, edits filenames, resolves conflicts
 *   3. Click OK → folder picker / ZIP generation proceeds
 *
 * These tests use the ZIP fallback (showDirectoryPicker absent) for simplicity.
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

function makeInstance(overrides = {}) {
  return {
    id: 10,
    _tempId: 'tmp_test_1',
    query_id: 1,
    label: 'My Chart',
    position: 0,
    config: {},
    query: { id: 1, name: 'My Query', category: 'Test' },
    ...overrides,
  }
}

function makeReport(overrides = {}) {
  return {
    id: 1,
    name: 'Test Report',
    description: '',
    config: {},
    instances: [makeInstance()],
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
  HTMLAnchorElement.prototype.click = vi.fn()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Backdrop overlay (position fixed, zIndex 2000). */
function getBackdrop() {
  return document.querySelector('[style*="z-index: 2000"]')
}

/** All spellcheck-false inputs (the filename text boxes in the modal). */
function getFilenameInputs() {
  return [...document.querySelectorAll('input[spellcheck="false"]')]
}

/** All checkboxes inside the modal list. */
function getModalCheckboxes() {
  const backdrop = getBackdrop()
  if (!backdrop) return []
  return [...backdrop.querySelectorAll('input[type="checkbox"]')]
}

// ─── Modal appearance ─────────────────────────────────────────────────────────

describe('PngExportModal — appears when Generate PNGs clicked', () => {
  it('shows "⬇ Export PNGs" title after clicking Generate PNGs', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => expect(screen.getByText('⬇ Export PNGs')).toBeInTheDocument())
  })

  it('pre-fills filename with [label]_[startDate]_to_[endDate].png', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    const inputs = getFilenameInputs()
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toHaveValue('My Chart_2026-01-01_to_2026-06-30.png')
  })

  it('chart is checked by default', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    const checkboxes = getModalCheckboxes()
    expect(checkboxes).toHaveLength(1)
    expect(checkboxes[0]).toBeChecked()
  })

  it('shows Select all and Select none buttons', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    expect(screen.getByText('Select all')).toBeInTheDocument()
    expect(screen.getByText('Select none')).toBeInTheDocument()
  })

  it('shows instance label as a read-only label next to the filename input', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    expect(screen.getByText('My Chart')).toBeInTheDocument()
  })
})

// ─── Multiple instances ────────────────────────────────────────────────────────

describe('PngExportModal — multiple instances', () => {
  function makeMultiReport() {
    return makeReport({
      instances: [
        makeInstance({ id: 10, _tempId: 'tmp_1', label: 'Alpha' }),
        makeInstance({ id: 11, _tempId: 'tmp_2', label: 'Beta'  }),
        makeInstance({ id: 12, _tempId: 'tmp_3', label: 'Gamma' }),
      ],
    })
  }

  it('shows one filename input per instance', async () => {
    render(<ReportBuilder report={makeMultiReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    expect(getFilenameInputs()).toHaveLength(3)
  })

  it('Select none unchecks all charts', async () => {
    render(<ReportBuilder report={makeMultiReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByText('Select none'))
    getModalCheckboxes().forEach(cb => expect(cb).not.toBeChecked())
  })

  it('Select all re-checks all charts after Select none', async () => {
    render(<ReportBuilder report={makeMultiReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByText('Select none'))
    fireEvent.click(screen.getByText('Select all'))
    getModalCheckboxes().forEach(cb => expect(cb).toBeChecked())
  })

  it('individual checkbox toggles only that row', async () => {
    render(<ReportBuilder report={makeMultiReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const [cb1, cb2, cb3] = getModalCheckboxes()
    fireEvent.click(cb2)
    expect(cb1).toBeChecked()
    expect(cb2).not.toBeChecked()
    expect(cb3).toBeChecked()
  })
})

// ─── Filename editing ─────────────────────────────────────────────────────────

describe('PngExportModal — filename editing', () => {
  it('filename input is editable', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const input = getFilenameInputs()[0]
    fireEvent.change(input, { target: { value: 'custom-name.png' } })
    expect(input).toHaveValue('custom-name.png')
  })
})

// ─── Conflict detection ────────────────────────────────────────────────────────

describe('PngExportModal — conflict detection', () => {
  function makeTwoChartReport() {
    return makeReport({
      instances: [
        makeInstance({ id: 10, _tempId: 'tmp_1', label: 'Alpha' }),
        makeInstance({ id: 11, _tempId: 'tmp_2', label: 'Beta'  }),
      ],
    })
  }

  it('no conflict warning when filenames are unique', async () => {
    render(<ReportBuilder report={makeTwoChartReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))
    expect(screen.queryByText(/duplicate filenames/i)).not.toBeInTheDocument()
  })

  it('conflict warning appears when two filenames are made identical', async () => {
    render(<ReportBuilder report={makeTwoChartReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const [input1, input2] = getFilenameInputs()
    fireEvent.change(input1, { target: { value: 'same-name.png' } })
    fireEvent.change(input2, { target: { value: 'same-name.png' } })

    expect(screen.getByText(/duplicate filenames/i)).toBeInTheDocument()
  })

  it('conflict warning disappears when filenames are made unique again', async () => {
    render(<ReportBuilder report={makeTwoChartReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const [input1, input2] = getFilenameInputs()
    fireEvent.change(input1, { target: { value: 'same-name.png' } })
    fireEvent.change(input2, { target: { value: 'same-name.png' } })
    expect(screen.getByText(/duplicate filenames/i)).toBeInTheDocument()

    fireEvent.change(input2, { target: { value: 'different-name.png' } })
    expect(screen.queryByText(/duplicate filenames/i)).not.toBeInTheDocument()
  })

  it('unchecking one of two conflicting charts removes the warning', async () => {
    render(<ReportBuilder report={makeTwoChartReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const [input1, input2] = getFilenameInputs()
    fireEvent.change(input1, { target: { value: 'same-name.png' } })
    fireEvent.change(input2, { target: { value: 'same-name.png' } })
    expect(screen.getByText(/duplicate filenames/i)).toBeInTheDocument()

    // Uncheck the second chart — conflict is now moot
    const [, cb2] = getModalCheckboxes()
    fireEvent.click(cb2)
    expect(screen.queryByText(/duplicate filenames/i)).not.toBeInTheDocument()
  })
})

// ─── Dismissal ────────────────────────────────────────────────────────────────

describe('PngExportModal — dismissal without generating', () => {
  it('Cancel button closes modal', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())
  })

  it('Cancel does not trigger ZIP generation', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())

    // Small wait to ensure nothing fires asynchronously
    await new Promise(r => setTimeout(r, 100))
    expect(buildZipBytes).not.toHaveBeenCalled()
  })

  it('Escape key closes modal', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const backdrop = getBackdrop()
    fireEvent.keyDown(backdrop, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())
  })

  it('clicking the backdrop closes the modal', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const backdrop = getBackdrop()
    const clickEvent = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEvent, 'target',      { value: backdrop })
    Object.defineProperty(clickEvent, 'currentTarget', { value: backdrop })
    backdrop.dispatchEvent(clickEvent)

    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())
  })
})

// ─── OK confirms and triggers generation ──────────────────────────────────────

describe('PngExportModal — OK triggers generation', () => {
  it('clicking OK closes the modal', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())
  })

  it('clicking OK with one chart selected triggers ZIP generation', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('ZIP contains the filename set in the modal', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.change(getFilenameInputs()[0], { target: { value: 'my-custom.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
    expect(buildZipBytes.mock.calls[0][0][0].name).toBe('my-custom.png')
  })

  it('clicking OK with all charts deselected does not trigger ZIP', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByText('Select none'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())

    await new Promise(r => setTimeout(r, 100))
    expect(buildZipBytes).not.toHaveBeenCalled()
  })

  it('only selected charts are included in the ZIP', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    const report = makeReport({
      instances: [
        makeInstance({ id: 10, _tempId: 'tmp_1', label: 'Alpha' }),
        makeInstance({ id: 11, _tempId: 'tmp_2', label: 'Beta'  }),
      ],
    })

    render(<ReportBuilder report={report} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    // Uncheck Beta
    const [, cb2] = getModalCheckboxes()
    fireEvent.click(cb2)

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
    // Only 1 file in the ZIP (Alpha only)
    expect(buildZipBytes.mock.calls[0][0]).toHaveLength(1)
    expect(buildZipBytes.mock.calls[0][0][0].name).toBe('Alpha_2026-01-01_to_2026-06-30.png')
  })

  it('status message updates to reflect completed generation', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => {
      expect(screen.getByText(/PNG.*downloaded/i)).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})

// ─── buildDefaultFilename logic ───────────────────────────────────────────────

describe('PngExportModal — default filename format', () => {
  it('uses YYYY-MM-DD_to_YYYY-MM-DD date range in the default name', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const input = getFilenameInputs()[0]
    // Label is "My Chart", dates are 2026-01-01 to 2026-06-30
    expect(input.value).toMatch(/2026-01-01_to_2026-06-30\.png$/)
  })

  it('sanitises illegal filename characters in the label', async () => {
    const report = makeReport({
      instances: [makeInstance({ label: 'My/Chart:Name?' })],
    })
    render(<ReportBuilder report={report} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    const input = getFilenameInputs()[0]
    // /  :  ? should all become _
    expect(input.value).not.toMatch(/[/:?]/)
  })
})

// ─── .png extension enforcement ──────────────────────────────────────────────

describe('PngExportModal — .png extension enforcement on OK', () => {
  it('appends .png when user removes the extension before clicking OK', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.change(getFilenameInputs()[0], { target: { value: 'my-chart' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
    expect(buildZipBytes.mock.calls[0][0][0].name).toBe('my-chart.png')
  })

  it('does not double-append .png when extension already present', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.change(getFilenameInputs()[0], { target: { value: 'already-correct.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
    expect(buildZipBytes.mock.calls[0][0][0].name).toBe('already-correct.png')
  })

  it('extension check is case-insensitive — .PNG not double-extended', async () => {
    const { buildZipBytes } = await import('../../utils/zipBuilder.js')

    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    fireEvent.change(getFilenameInputs()[0], { target: { value: 'UPPERCASE.PNG' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(buildZipBytes).toHaveBeenCalled(), { timeout: 5000 })
    expect(buildZipBytes.mock.calls[0][0][0].name).toBe('UPPERCASE.PNG')
  })
})

// ─── Escape works immediately on open (auto-focus) ────────────────────────────

describe('PngExportModal — Escape works immediately on open', () => {
  it('Escape on the backdrop closes the modal without any prior click', async () => {
    render(<ReportBuilder report={makeReport()} {...baseProps} />)
    fireEvent.click(screen.getByText('⬇ Generate PNGs'))
    await waitFor(() => screen.getByText('⬇ Export PNGs'))

    // Fire Escape directly on the backdrop (which should be auto-focused)
    const backdrop = getBackdrop()
    fireEvent.keyDown(backdrop, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByText('⬇ Export PNGs')).not.toBeInTheDocument())
  })
})
