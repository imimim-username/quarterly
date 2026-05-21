import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../api/client.js', () => ({
  listEndpoints:  vi.fn(),
  createEndpoint: vi.fn(),
  updateEndpoint: vi.fn(),
  deleteEndpoint: vi.fn(),
}))

import EndpointProfilesModal from '../EndpointProfilesModal.jsx'
import { listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint } from '../../api/client.js'

const PROFILES = [
  { id: 1, name: 'Local Dev',    url: 'http://localhost:8787/graphql', is_default: false, headers: {} },
  { id: 2, name: 'Production',   url: 'https://prod.example.com/graphql', is_default: true, headers: {} },
]

describe('EndpointProfilesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listEndpoints.mockResolvedValue({ data: [] })
    createEndpoint.mockResolvedValue({ ok: true, data: { id: 99 } })
    updateEndpoint.mockResolvedValue({ ok: true, data: {} })
    deleteEndpoint.mockResolvedValue({ ok: true })
  })

  it('renders "No profiles yet." when endpoint list is empty', async () => {
    render(<EndpointProfilesModal onClose={() => {}} onSelect={() => {}} />)

    await waitFor(() => expect(screen.getByText('No profiles yet.')).toBeInTheDocument())
  })

  it('renders profile list when profiles exist (name, url)', async () => {
    listEndpoints.mockResolvedValue({ data: PROFILES })
    render(<EndpointProfilesModal onClose={() => {}} onSelect={() => {}} />)

    await waitFor(() => expect(screen.getByText('Local Dev')).toBeInTheDocument())
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('http://localhost:8787/graphql')).toBeInTheDocument()
    expect(screen.getByText('https://prod.example.com/graphql')).toBeInTheDocument()
  })

  it('clicking "+ New Profile" shows the form', async () => {
    render(<EndpointProfilesModal onClose={() => {}} onSelect={() => {}} />)

    await waitFor(() => expect(screen.getByText('No profiles yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Profile'))

    // Form title
    expect(screen.getByText('New Profile')).toBeInTheDocument()
    // Name and URL inputs should be visible
    expect(screen.getByPlaceholderText('My Ponder Node')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://your-ponder-endpoint.com/')).toBeInTheDocument()
  })

  it('filling name and URL and clicking Save calls createEndpoint', async () => {
    // On save + refresh listEndpoints is called again, return empty again
    listEndpoints.mockResolvedValue({ data: [] })

    render(<EndpointProfilesModal onClose={() => {}} onSelect={() => {}} />)

    await waitFor(() => expect(screen.getByText('No profiles yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ New Profile'))

    fireEvent.change(screen.getByPlaceholderText('My Ponder Node'), {
      target: { value: 'New Node' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://your-ponder-endpoint.com/'), {
      target: { value: 'https://new.example.com/graphql' },
    })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(createEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Node', url: 'https://new.example.com/graphql' })
      )
    )
  })

  it('clicking "Use →" on a profile calls onSelect(profile) and onClose()', async () => {
    listEndpoints.mockResolvedValue({ data: PROFILES })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<EndpointProfilesModal onClose={onClose} onSelect={onSelect} />)

    await waitFor(() => expect(screen.getByText('Local Dev')).toBeInTheDocument())

    const useButtons = screen.getAllByText('Use →')
    fireEvent.click(useButtons[0])

    expect(onSelect).toHaveBeenCalledWith(PROFILES[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"Delete" button calls deleteEndpoint after window.confirm returns true', async () => {
    listEndpoints.mockResolvedValue({ data: PROFILES })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<EndpointProfilesModal onClose={() => {}} onSelect={() => {}} />)

    await waitFor(() => expect(screen.getByText('Local Dev')).toBeInTheDocument())

    // Select a profile to show its form (and Delete button)
    fireEvent.click(screen.getByText('Local Dev'))

    const deleteBtn = screen.getByText('Delete')
    fireEvent.click(deleteBtn)

    await waitFor(() => expect(deleteEndpoint).toHaveBeenCalledWith(1))

    vi.unstubAllGlobals()
  })
})
