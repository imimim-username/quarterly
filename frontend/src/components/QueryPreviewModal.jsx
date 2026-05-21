import React, { useState, useCallback } from 'react'

/**
 * Small centered modal that shows the GraphQL query and variables
 * actually sent to the endpoint for a given run.
 *
 * Props:
 *   run      — the currentRun object from App state
 *   onClose  — called when the user dismisses the modal
 */
export default function QueryPreviewModal({ run, onClose }) {
  const [copied, setCopied] = useState(null) // 'query' | 'vars' | null

  const copy = useCallback((text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    }).catch(() => {})
  }, [])

  const gql       = run?.gql_used   ?? null   // present on fresh runs
  const variables = run?.variables_base ?? {}
  const endpoint  = run?.endpoint   ?? '—'
  const varsJson  = JSON.stringify(variables, null, 2)

  // Backdrop click closes the modal
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        width: '100%',
        maxWidth: 720,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Query sent to endpoint</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 12, padding: '2px 8px' }}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Endpoint */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Endpoint</div>
            <code style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--color-text)' }}>{endpoint}</code>
          </div>

          {/* Query */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Query</span>
              {gql && (
                <button
                  onClick={() => copy(gql, 'query')}
                  style={{ fontSize: 11, padding: '1px 6px' }}
                >
                  {copied === 'query' ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </div>
            {gql ? (
              <pre style={{
                margin: 0,
                padding: '10px 12px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                fontSize: 12,
                overflowX: 'auto',
                whiteSpace: 'pre',
                color: 'var(--color-text)',
              }}>
                {gql}
              </pre>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Query text not available for historical runs loaded from the history drawer.
              </div>
            )}
          </div>

          {/* Variables */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Variables</span>
              <button
                onClick={() => copy(varsJson, 'vars')}
                style={{ fontSize: 11, padding: '1px 6px' }}
              >
                {copied === 'vars' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre style={{
              margin: 0,
              padding: '10px 12px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              fontSize: 12,
              overflowX: 'auto',
              whiteSpace: 'pre',
              color: 'var(--color-text)',
            }}>
              {varsJson}
            </pre>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Note: pagination args (limit / offset) are injected automatically per page and are not shown here.
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
