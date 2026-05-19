import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import SchemaExplorer from '../SchemaExplorer.jsx'

// GraphiQL is a large runtime dep — stub it with a minimal stand-in that
// exposes a button to simulate the user typing a query (triggering onEditQuery).
vi.mock('graphiql', () => ({
  GraphiQL: ({ onEditQuery }) => (
    <div data-testid="graphiql-stub">
      <button
        data-testid="set-query"
        onClick={() => onEditQuery('{ transfers { id amount } }')}
      >
        set query
      </button>
    </div>
  ),
}))

vi.mock('@graphiql/plugin-explorer', () => ({
  explorerPlugin: () => ({ title: 'Explorer', icon: () => null, content: () => null }),
}))

const noop = () => {}

describe('SchemaExplorer', () => {
  it('renders the header label and both action buttons', () => {
    render(<SchemaExplorer onClose={noop} onUseQuery={noop} />)
    expect(screen.getByText('Schema Explorer')).toBeInTheDocument()
    expect(screen.getByTitle('Pre-fill the query editor with this query')).toBeInTheDocument()
    expect(screen.getByTitle('Close schema explorer')).toBeInTheDocument()
  })

  it('"Use This Query" is disabled when no query has been entered', () => {
    render(<SchemaExplorer onClose={noop} onUseQuery={noop} />)
    expect(screen.getByTitle('Pre-fill the query editor with this query')).toBeDisabled()
  })

  it('"Use This Query" enables once GraphiQL fires onEditQuery with non-empty text', () => {
    render(<SchemaExplorer onClose={noop} onUseQuery={noop} />)
    fireEvent.click(screen.getByTestId('set-query'))
    expect(screen.getByTitle('Pre-fill the query editor with this query')).not.toBeDisabled()
  })

  it('calls onUseQuery with the current query text when clicked', () => {
    const onUseQuery = vi.fn()
    render(<SchemaExplorer onClose={noop} onUseQuery={onUseQuery} />)
    fireEvent.click(screen.getByTestId('set-query'))
    fireEvent.click(screen.getByTitle('Pre-fill the query editor with this query'))
    expect(onUseQuery).toHaveBeenCalledWith('{ transfers { id amount } }')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<SchemaExplorer onClose={onClose} onUseQuery={noop} />)
    fireEvent.click(screen.getByTitle('Close schema explorer'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
