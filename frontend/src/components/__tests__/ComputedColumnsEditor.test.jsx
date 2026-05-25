import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ComputedColumnsEditor from '../ComputedColumnsEditor.jsx'

describe('ComputedColumnsEditor — empty state', () => {
  it('shows empty message when no defs', () => {
    render(<ComputedColumnsEditor defs={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/no computed columns/i)).toBeInTheDocument()
  })

  it('shows an Add column button', () => {
    render(<ComputedColumnsEditor defs={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add column/i })).toBeInTheDocument()
  })
})

describe('ComputedColumnsEditor — existing defs', () => {
  const defs = [{ name: 'ratio', label: 'Ratio', formula: 'a / b' }]

  it('renders existing column names', () => {
    render(<ComputedColumnsEditor defs={defs} onChange={vi.fn()} />)
    expect(screen.getByText('ratio')).toBeInTheDocument()
    expect(screen.getByText('Ratio')).toBeInTheDocument()
    expect(screen.getByText('a / b')).toBeInTheDocument()
  })

  it('clicking Edit opens the form with existing values', () => {
    render(<ComputedColumnsEditor defs={defs} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    // Name field should be present (readonly when editing) and populated
    const nameInput = screen.getByPlaceholderText(/price_ratio/i)
    expect(nameInput.value).toBe('ratio')
  })

  it('clicking ✕ calls onChange without that column', () => {
    const onChange = vi.fn()
    render(<ComputedColumnsEditor defs={defs} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /✕/ }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('ComputedColumnsEditor — add flow', () => {
  it('calls onChange with new column when Add is submitted', () => {
    const onChange = vi.fn()
    render(<ComputedColumnsEditor defs={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /add column/i }))

    fireEvent.change(screen.getByPlaceholderText(/price_ratio/i), { target: { value: 'my_col' } })
    fireEvent.change(screen.getByPlaceholderText(/price ratio/i), { target: { value: 'My Col' } })
    fireEvent.change(screen.getByPlaceholderText(/volume \/ price/i), { target: { value: 'a + b' } })

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(onChange).toHaveBeenCalledWith([
      { name: 'my_col', label: 'My Col', formula: 'a + b' },
    ])
  })

  it('shows error for invalid formula', () => {
    render(<ComputedColumnsEditor defs={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add column/i }))

    fireEvent.change(screen.getByPlaceholderText(/price_ratio/i), { target: { value: 'col' } })
    fireEvent.change(screen.getByPlaceholderText(/volume \/ price/i), { target: { value: '(a + b' } })

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByText(/formula is invalid/i)).toBeInTheDocument()
  })

  it('shows error for invalid name (spaces)', () => {
    render(<ComputedColumnsEditor defs={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add column/i }))

    fireEvent.change(screen.getByPlaceholderText(/price_ratio/i), { target: { value: 'bad name' } })
    fireEvent.change(screen.getByPlaceholderText(/volume \/ price/i), { target: { value: 'a + b' } })

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByText(/start with a letter/i)).toBeInTheDocument()
  })

  it('shows error for duplicate name', () => {
    const onChange = vi.fn()
    const defs = [{ name: 'existing', label: 'E', formula: 'a' }]
    render(<ComputedColumnsEditor defs={defs} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add column/i }))

    fireEvent.change(screen.getByPlaceholderText(/price_ratio/i), { target: { value: 'existing' } })
    fireEvent.change(screen.getByPlaceholderText(/volume \/ price/i), { target: { value: 'b' } })

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Cancel closes the form without calling onChange', () => {
    const onChange = vi.fn()
    render(<ComputedColumnsEditor defs={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add column/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByRole('button', { name: /add column/i })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ComputedColumnsEditor — reorder', () => {
  const defs = [
    { name: 'a_col', label: 'A', formula: 'x' },
    { name: 'b_col', label: 'B', formula: 'y' },
  ]

  it('Move down swaps the order', () => {
    const onChange = vi.fn()
    render(<ComputedColumnsEditor defs={defs} onChange={onChange} />)
    const downButtons = screen.getAllByTitle(/move down/i)
    fireEvent.click(downButtons[0])
    expect(onChange).toHaveBeenCalledWith([defs[1], defs[0]])
  })

  it('Move up swaps the order', () => {
    const onChange = vi.fn()
    render(<ComputedColumnsEditor defs={defs} onChange={onChange} />)
    const upButtons = screen.getAllByTitle(/move up/i)
    fireEvent.click(upButtons[1])
    expect(onChange).toHaveBeenCalledWith([defs[1], defs[0]])
  })
})
