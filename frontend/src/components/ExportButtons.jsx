import React from 'react'
import { exportRunJson, exportRunCsv } from '../api/client.js'

/**
 * ExportButtons — Download JSON and CSV links for a run.
 */
export default function ExportButtons({ runId }) {
  if (!runId) return null

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <a
        href={exportRunJson(runId)}
        download
        style={{
          padding: '5px 12px',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          fontSize: 12,
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        ↓ JSON
      </a>
      <a
        href={exportRunCsv(runId)}
        download
        style={{
          padding: '5px 12px',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          fontSize: 12,
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        ↓ CSV
      </a>
    </div>
  )
}
