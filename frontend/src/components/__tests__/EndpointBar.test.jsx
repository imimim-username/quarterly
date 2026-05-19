import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock the API client before importing the component
vi.mock('../../api/client.js', () => ({
  getSettings:    vi.fn(),
  updateSettings: vi.fn(),
  pingEndpoint:   vi.fn(),
}))

import EndpointBar from '../EndpointBar.jsx'
import { getSettings, updateSettings, pingEndpoint } from '../../api/client.js'

const VALID_URL = 'https://example.com/graphql'

describe('EndpointBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSettings.mockResolvedValue({ data: { endpoint: '' } })
  })

  it('"Explore Schema" button is hidden before any ping', () => {
    render(<EndpointBar onExplore={() => {}} />)
    expect(screen.queryByTitle('Open GraphiQL schema explorer')).not.toBeInTheDocument()
  })

  it('"Explore Schema" button appears after endpoint is saved and ping succeeds', async () => {
    updateSettings.mockResolvedValue({ ok: true, data: {} })
    pingEndpoint.mockResolvedValue({ data: { ok: true, latency_ms: 42 } })

    render(<EndpointBar onExplore={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_URL } })
    fireEvent.blur(screen.getByRole('textbox'))

    await waitFor(() =>
      expect(screen.getByTitle('Open GraphiQL schema explorer')).toBeInTheDocument()
    )
  })

  it('clicking "Explore Schema" calls onExplore', async () => {
    updateSettings.mockResolvedValue({ ok: true, data: {} })
    pingEndpoint.mockResolvedValue({ data: { ok: true, latency_ms: 42 } })
    const onExplore = vi.fn()

    render(<EndpointBar onExplore={onExplore} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_URL } })
    fireEvent.blur(screen.getByRole('textbox'))

    await waitFor(() => screen.getByTitle('Open GraphiQL schema explorer'))
    fireEvent.click(screen.getByTitle('Open GraphiQL schema explorer'))

    expect(onExplore).toHaveBeenCalledTimes(1)
  })

  it('"Explore Schema" button is hidden after a failed ping', async () => {
    updateSettings.mockResolvedValue({ ok: true, data: {} })
    pingEndpoint.mockResolvedValue({ data: { ok: false } })

    render(<EndpointBar onExplore={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_URL } })
    fireEvent.blur(screen.getByRole('textbox'))

    await waitFor(() => expect(pingEndpoint).toHaveBeenCalled())
    expect(screen.queryByTitle('Open GraphiQL schema explorer')).not.toBeInTheDocument()
  })

  it('shows an inline error for an invalid URL and does not call pingEndpoint', async () => {
    render(<EndpointBar onExplore={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-url' } })
    fireEvent.blur(screen.getByRole('textbox'))

    await waitFor(() =>
      expect(screen.getByText('Invalid URL format.')).toBeInTheDocument()
    )
    expect(pingEndpoint).not.toHaveBeenCalled()
  })
})
