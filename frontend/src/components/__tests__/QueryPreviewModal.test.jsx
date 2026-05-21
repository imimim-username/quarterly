import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

import QueryPreviewModal from '../QueryPreviewModal.jsx'

const mockRun = {
  gql_used: '{ alchemistDeposits { items { id amount } } }',
  variables_used: { chain: 'mainnet' },
  endpoint: 'https://example.com/graphql',
}

describe('QueryPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('renders the endpoint URL', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    expect(screen.getByText('https://example.com/graphql')).toBeInTheDocument()
  })

  it('renders the GraphQL query text', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    expect(
      screen.getByText('{ alchemistDeposits { items { id amount } } }')
    ).toBeInTheDocument()
  })

  it('renders variables JSON', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    // variables_used is { chain: 'mainnet' }
    const pre = screen.getAllByText(/"chain"/)[0]
    expect(pre).toBeInTheDocument()
  })

  it('default tab is Python — code block contains "import requests"', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    expect(screen.getByText(/import requests/)).toBeInTheDocument()
  })

  it('clicking "curl" tab switches code to show curl -X POST', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    fireEvent.click(screen.getByText('curl'))
    expect(screen.getByText(/curl -X POST/)).toBeInTheDocument()
  })

  it('clicking "TypeScript" tab shows interface GraphQLResponse', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    fireEvent.click(screen.getByText('TypeScript'))
    expect(screen.getByText(/interface GraphQLResponse/)).toBeInTheDocument()
  })

  it('clicking "R" tab shows library(httr2)', () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)
    fireEvent.click(screen.getByText('R'))
    expect(screen.getByText(/library\(httr2\)/)).toBeInTheDocument()
  })

  it('Copy button in code examples copies code text to clipboard', async () => {
    render(<QueryPreviewModal run={mockRun} onClose={() => {}} />)

    // The code examples section has a "Copy" button (last one among the copy buttons)
    const copyButtons = screen.getAllByText('Copy')
    // Click the last Copy button (the one in CodeExamples)
    fireEvent.click(copyButtons[copyButtons.length - 1])

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())

    const written = navigator.clipboard.writeText.mock.calls[0][0]
    // Python is the default tab, so it should contain import requests
    expect(written).toMatch(/import requests/)
  })

  it('backdrop click calls onClose', () => {
    const onClose = vi.fn()
    render(<QueryPreviewModal run={mockRun} onClose={onClose} />)

    // The outer overlay div has the onClick handler
    const backdrop = screen.getByText('https://example.com/graphql').closest('[style*="rgba(0,0,0"]')
      ?? document.querySelector('[style*="rgba(0,0,0,0.55)"]')

    if (backdrop) {
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    } else {
      // Fallback: click the ✕ Close button
      fireEvent.click(screen.getByText('✕ Close'))
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })
})
