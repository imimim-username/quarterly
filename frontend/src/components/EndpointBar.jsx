import React, { useState, useEffect, useCallback } from 'react'
import { getSettings, updateSettings, pingEndpoint } from '../api/client.js'

/**
 * EndpointBar — wide text input for the Ponder endpoint URL.
 * Shows a connection dot (green/yellow/red) reflecting last ping result.
 * Saves to settings on blur/Enter. Shows inline validation errors.
 */
export default function EndpointBar({ onExplore }) {
  const [endpoint, setEndpoint] = useState('')
  const [status, setStatus] = useState('yellow') // 'green' | 'yellow' | 'red'
  const [error, setError] = useState('')
  const [pinging, setPinging] = useState(false)
  const [latency, setLatency] = useState(null)

  // Load saved endpoint on mount
  useEffect(() => {
    getSettings().then(({ data }) => {
      if (data && data.endpoint) {
        setEndpoint(data.endpoint)
      }
    }).catch(() => {})
  }, [])

  const doPing = useCallback(async () => {
    if (pinging) return
    setPinging(true)
    setStatus('yellow')
    setLatency(null)
    try {
      const { data } = await pingEndpoint()
      if (data && data.ok) {
        setStatus('green')
        setLatency(data.latency_ms)
      } else {
        setStatus('red')
        setLatency(null)
      }
    } catch (e) {
      setStatus('red')
    } finally {
      setPinging(false)
    }
  }, [pinging])

  const saveEndpoint = useCallback(async (value) => {
    setError('')
    if (!value.trim()) {
      setStatus('yellow')
      return
    }

    // Basic URL validation
    try {
      new URL(value.trim())
    } catch (e) {
      setError('Invalid URL format.')
      setStatus('red')
      return
    }

    try {
      const { data, ok } = await updateSettings({ endpoint: value.trim() })
      if (!ok) {
        setError(data?.message || 'Failed to save endpoint.')
        setStatus('red')
        return
      }
      // Ping after save
      await doPing()
    } catch (e) {
      setError('Failed to save endpoint: ' + e.message)
      setStatus('red')
    }
  }, [doPing])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur()
    }
  }

  const handleBlur = (e) => {
    saveEndpoint(e.target.value)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <span
        className={`connection-dot ${status}`}
        title={
          status === 'green'
            ? `Connected${latency != null ? ` (${latency}ms)` : ''}`
            : status === 'yellow'
            ? 'Not yet pinged'
            : 'Unreachable or blocked'
        }
      />
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="url"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="https://your-ponder-endpoint.com/graphql"
          style={{ width: '100%' }}
          aria-label="Ponder endpoint URL"
        />
        {error && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            fontSize: 11,
            color: 'var(--color-error)',
            marginTop: 2,
            whiteSpace: 'nowrap',
          }}>
            {error}
          </div>
        )}
      </div>
      <button
        onClick={doPing}
        disabled={pinging || !endpoint.trim()}
        style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
        title="Ping the endpoint"
      >
        {pinging ? <span className="spinner" /> : 'Ping'}
      </button>
      {status === 'green' && onExplore && (
        <button
          onClick={onExplore}
          style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}
          title="Open GraphiQL schema explorer"
        >
          Explore Schema
        </button>
      )}
    </div>
  )
}
