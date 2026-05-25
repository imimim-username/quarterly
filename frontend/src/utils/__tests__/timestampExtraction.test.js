import { describe, it, expect } from 'vitest'
import { applyTimestampExtraction, timestampExtractionMeta } from '../timestampExtraction.js'

// ─── applyTimestampExtraction ─────────────────────────────────────────────────

describe('applyTimestampExtraction — guard cases', () => {
  const config = { sourceField: 'id', delimiter: '/', position: 'after', outputName: 'ts', outputLabel: 'TS' }

  it('returns rows unchanged when config is null', () => {
    const rows = [{ id: 'abc/123' }]
    expect(applyTimestampExtraction(rows, null)).toEqual(rows)
  })

  it('returns rows unchanged when rows is empty', () => {
    expect(applyTimestampExtraction([], config)).toEqual([])
  })

  it('returns rows unchanged when sourceField is missing from config', () => {
    const rows = [{ id: 'abc/123' }]
    expect(applyTimestampExtraction(rows, { delimiter: '/', position: 'after', outputName: 'ts' })).toEqual(rows)
  })

  it('returns rows unchanged when outputName is missing from config', () => {
    const rows = [{ id: 'abc/123' }]
    expect(applyTimestampExtraction(rows, { sourceField: 'id', delimiter: '/', position: 'after' })).toEqual(rows)
  })

  it('returns rows unchanged when delimiter is missing from config', () => {
    const rows = [{ id: 'abc/123' }]
    expect(applyTimestampExtraction(rows, { sourceField: 'id', position: 'after', outputName: 'ts' })).toEqual(rows)
  })

  it('does not mutate original rows', () => {
    const rows = [{ id: 'abc/123' }]
    const original = JSON.parse(JSON.stringify(rows))
    applyTimestampExtraction(rows, config)
    expect(rows).toEqual(original)
  })
})

describe('applyTimestampExtraction — position: after', () => {
  const config = { sourceField: 'id', delimiter: '/', position: 'after', outputName: 'ts', outputLabel: 'Timestamp' }

  it('extracts the fragment after the delimiter', () => {
    const rows = [{ id: '0xabc/1777973684' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(1777973684)
  })

  it('handles multiple rows independently', () => {
    const rows = [
      { id: '0xaaa/1000000' },
      { id: '0xbbb/2000000' },
    ]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(1000000)
    expect(result[1].ts).toBe(2000000)
  })

  it('splits on the FIRST occurrence of the delimiter', () => {
    // "a/b/123" → after first "/" → "b/123" → NaN → null
    const rows = [{ id: 'a/b/123' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeNull()  // "b/123" is not a number
  })

  it('uses whole string when delimiter is not found', () => {
    const rows = [{ id: '1777973684' }]  // no "/" in the value
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(1777973684)
  })
})

describe('applyTimestampExtraction — position: before', () => {
  const config = { sourceField: 'id', delimiter: '/', position: 'before', outputName: 'ts', outputLabel: 'Timestamp' }

  it('extracts the fragment before the delimiter', () => {
    const rows = [{ id: '1777973684/0xabc' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(1777973684)
  })

  it('returns null when the before-fragment is not a number', () => {
    const rows = [{ id: 'notanumber/0xabc' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeNull()
  })
})

describe('applyTimestampExtraction — edge cases', () => {
  const config = { sourceField: 'id', delimiter: '/', position: 'after', outputName: 'ts', outputLabel: 'TS' }

  it('returns null when sourceField value is null', () => {
    const rows = [{ id: null }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeNull()
  })

  it('returns null when sourceField value is undefined', () => {
    const rows = [{}]  // 'id' key not present → undefined
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeNull()
  })

  it('returns null when extracted fragment is non-numeric', () => {
    const rows = [{ id: '0xabc/notanumber' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeNull()
  })

  it('trims whitespace from extracted fragment', () => {
    const rows = [{ id: '0xabc/ 1777973684 ' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(1777973684)
  })

  it('handles multi-character delimiter', () => {
    const configDouble = { ...config, delimiter: '::' }
    const rows = [{ id: 'prefix::1777973684' }]
    const result = applyTimestampExtraction(rows, configDouble)
    expect(result[0].ts).toBe(1777973684)
  })

  it('handles decimal timestamps', () => {
    const rows = [{ id: 'prefix/1777973684.5' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBeCloseTo(1777973684.5)
  })

  it('preserves all existing fields on the row', () => {
    const rows = [{ id: '0xabc/123', name: 'foo', value: 99 }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].name).toBe('foo')
    expect(result[0].value).toBe(99)
    expect(result[0].ts).toBe(123)
  })

  it('extracted column is available for subsequent rows (no cross-row leakage)', () => {
    const rows = [{ id: 'a/100' }, { id: 'b/200' }]
    const result = applyTimestampExtraction(rows, config)
    expect(result[0].ts).toBe(100)
    expect(result[1].ts).toBe(200)
  })
})

// ─── timestampExtractionMeta ──────────────────────────────────────────────────

describe('timestampExtractionMeta', () => {
  it('returns empty object when config is null', () => {
    expect(timestampExtractionMeta(null)).toEqual({})
  })

  it('returns empty object when config has no outputName', () => {
    expect(timestampExtractionMeta({ sourceField: 'id', delimiter: '/' })).toEqual({})
  })

  it('returns correct meta entry with label', () => {
    const config = { outputName: 'parsed_ts', outputLabel: 'Timestamp' }
    const meta = timestampExtractionMeta(config)
    expect(meta.parsed_ts).toEqual({ label: 'Timestamp', computed: true, datetime: true })
  })

  it('falls back to outputName when outputLabel is empty', () => {
    const config = { outputName: 'parsed_ts', outputLabel: '' }
    const meta = timestampExtractionMeta(config)
    expect(meta.parsed_ts.label).toBe('parsed_ts')
  })

  it('marks the entry as datetime: true for divisor defaulting', () => {
    const config = { outputName: 'ts', outputLabel: 'TS' }
    expect(timestampExtractionMeta(config).ts.datetime).toBe(true)
  })
})
