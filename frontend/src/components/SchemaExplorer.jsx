import { useState, useEffect } from 'react'
import { GraphiQL } from 'graphiql'
import { Explorer } from 'graphiql-explorer'
import { buildClientSchema, getIntrospectionQuery } from 'graphql'
import 'graphiql/graphiql.css'

// Explorer plugin instance — created once outside the component so it's stable.
// (kept for reference; we now render Explorer directly instead of via the plugin system)

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

const INTROSPECTION = getIntrospectionQuery()

/**
 * SchemaExplorer — full-screen split overlay.
 *
 * Left panel:  graphiql-explorer field tree (visual query builder)
 * Right panel: GraphiQL editor + Docs + History
 *
 * Props:
 *   onClose()           — close the overlay without transferring a query
 *   onUseQuery(gql)     — close and pre-fill QueryEditor with the current query text
 */
export default function SchemaExplorer({ onClose, onUseQuery }) {
  const [currentQuery, setCurrentQuery] = useState('')
  const [schema, setSchema] = useState(null)

  // Fetch schema once on mount via the proxy (introspection query)
  useEffect(() => {
    fetcher({ query: INTROSPECTION })
      .then(r => { if (r?.data) setSchema(buildClientSchema(r.data)) })
      .catch(() => {})
  }, [])

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

      {/* Body: field tree on left, GraphiQL on right */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left panel — visual query builder */}
        <div style={{
          width: 320,
          flexShrink: 0,
          overflowY: 'auto',
          borderRight: '1px solid var(--color-border)',
        }}>
          {schema ? (
            <Explorer
              schema={schema}
              query={currentQuery}
              onEdit={setCurrentQuery}
              explorerIsOpen={true}
              onRunOperation={() => {}}
            />
          ) : (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-muted)' }}>
              Loading schema…
            </div>
          )}
        </div>

        {/* Right panel — GraphiQL editor, autocomplete, docs, history */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GraphiQL
            fetcher={fetcher}
            query={currentQuery}
            onEditQuery={setCurrentQuery}
          />
        </div>
      </div>
    </div>
  )
}
