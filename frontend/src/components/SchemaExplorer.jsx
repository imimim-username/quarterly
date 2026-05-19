import { useState } from 'react'
import { GraphiQL } from 'graphiql'
import { explorerPlugin } from '@graphiql/plugin-explorer'
import 'graphiql/graphiql.css'
import '@graphiql/plugin-explorer/dist/style.css'

// Explorer plugin instance — created once outside the component so it's stable.
const explorer = explorerPlugin({ showAttribution: false })

/**
 * Fetcher that routes all GraphQL traffic (including GraphiQL's own schema
 * introspection) through the quarterly backend's SSRF-protected proxy.
 */
const fetcher = async ({ query, variables, operationName }) => {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables, operationName }),
  })
  return res.json()
}

/**
 * SchemaExplorer — full-screen GraphiQL overlay.
 *
 * Props:
 *   onClose()           — close the overlay without transferring a query
 *   onUseQuery(gql)     — close and pre-fill QueryEditor with the current query text
 */
export default function SchemaExplorer({ onClose, onUseQuery }) {
  const [currentQuery, setCurrentQuery] = useState('')

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg)',
    }}>
      {/* Thin header strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
          Schema Explorer
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => onUseQuery(currentQuery)}
          disabled={!currentQuery.trim()}
          style={{ fontSize: 12, padding: '3px 10px' }}
          title="Pre-fill the query editor with this query"
        >
          Use This Query →
        </button>
        <button
          onClick={onClose}
          style={{ fontSize: 12, padding: '3px 10px' }}
          title="Close schema explorer"
        >
          ✕ Close
        </button>
      </div>

      {/* GraphiQL fills the remaining space — its own CSS handles internal layout */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <GraphiQL
          fetcher={fetcher}
          plugins={[explorer]}
          onEditQuery={setCurrentQuery}
        />
      </div>
    </div>
  )
}
