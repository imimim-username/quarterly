import { describe, it, expect } from 'vitest'
import { crc32, buildZipBytes } from '../zipBuilder.js'

// ── crc32 ─────────────────────────────────────────────────────────────────────

describe('crc32', () => {
  it('returns 0x00000000 for empty input', () => {
    // CRC-32 of zero bytes is always 0x00000000
    expect(crc32(new Uint8Array(0))).toBe(0x00000000)
  })

  it('returns known CRC for "123456789" (standard test vector)', () => {
    // RFC 3720 / CRC-32 standard test vector: "123456789" → 0xCBF43926
    const data = new TextEncoder().encode('123456789')
    expect(crc32(data)).toBe(0xCBF43926)
  })

  it('returns known CRC for single byte 0x00', () => {
    expect(crc32(new Uint8Array([0x00]))).toBe(0xD202EF8D)
  })

  it('returns known CRC for single byte 0xFF', () => {
    expect(crc32(new Uint8Array([0xFF]))).toBe(0xFF000000)
  })

  it('produces identical results for the same input', () => {
    const data = new TextEncoder().encode('hello world')
    expect(crc32(data)).toBe(crc32(data))
  })

  it('produces different results for different inputs', () => {
    const a = crc32(new TextEncoder().encode('hello'))
    const b = crc32(new TextEncoder().encode('world'))
    expect(a).not.toBe(b)
  })

  it('returns an unsigned 32-bit integer (no negative values)', () => {
    const data = new TextEncoder().encode('test')
    const result = crc32(data)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(0xFFFFFFFF)
  })
})

// ── buildZipBytes ─────────────────────────────────────────────────────────────

describe('buildZipBytes', () => {
  /** Read a little-endian uint16 from a DataView */
  const u16 = (dv, off) => dv.getUint16(off, true)
  /** Read a little-endian uint32 from a DataView */
  const u32 = (dv, off) => dv.getUint32(off, true)

  it('returns a Uint8Array', () => {
    const result = buildZipBytes([])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('empty ZIP contains only EOCD (22 bytes)', () => {
    const zip = buildZipBytes([])
    // Empty ZIP: no local headers, no central directory, just the 22-byte EOCD
    expect(zip.length).toBe(22)
    const dv = new DataView(zip.buffer)
    expect(u32(dv, 0)).toBe(0x06054b50)  // EOCD signature
    expect(u16(dv, 8)).toBe(0)           // 0 entries
    expect(u16(dv, 10)).toBe(0)
  })

  it('single file — local file header has correct signature and fields', () => {
    const enc = new TextEncoder()
    const name = 'hello.txt'
    const data = enc.encode('Hello, ZIP!')
    const zip = buildZipBytes([{ name, data }])
    const dv = new DataView(zip.buffer)

    // Local file header at offset 0
    expect(u32(dv, 0)).toBe(0x04034b50)              // LFH signature
    expect(u16(dv, 8)).toBe(0)                       // compression = STORE
    expect(u32(dv, 18)).toBe(data.length)            // compressed size
    expect(u32(dv, 22)).toBe(data.length)            // uncompressed size
    expect(u16(dv, 26)).toBe(enc.encode(name).length) // filename length
  })

  it('single file — CRC in local header matches crc32(data)', () => {
    const name = 'test.bin'
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const zip = buildZipBytes([{ name, data }])
    const dv = new DataView(zip.buffer)

    const storedCrc = u32(dv, 14)
    expect(storedCrc).toBe(crc32(data))
  })

  it('single file — file data appears immediately after local header', () => {
    const enc = new TextEncoder()
    const name = 'a.txt'
    const payload = new Uint8Array([42, 43, 44])
    const zip = buildZipBytes([{ name, data: payload }])

    const nameLen = enc.encode(name).length
    const dataStart = 30 + nameLen
    expect(Array.from(zip.slice(dataStart, dataStart + 3))).toEqual([42, 43, 44])
  })

  it('single file — EOCD reports 1 entry', () => {
    const name = 'x.png'
    const data = new Uint8Array(10)
    const zip = buildZipBytes([{ name, data }])
    const dv = new DataView(zip.buffer)

    // Find EOCD by scanning for its signature from the end
    let eocdOff = -1
    for (let i = zip.length - 22; i >= 0; i--) {
      if (u32(dv, i) === 0x06054b50) { eocdOff = i; break }
    }
    expect(eocdOff).toBeGreaterThanOrEqual(0)
    expect(u16(dv, eocdOff + 8)).toBe(1)   // entries on disk
    expect(u16(dv, eocdOff + 10)).toBe(1)  // total entries
  })

  it('two files — EOCD reports 2 entries', () => {
    const files = [
      { name: 'a.png', data: new Uint8Array([1, 2]) },
      { name: 'b.png', data: new Uint8Array([3, 4, 5]) },
    ]
    const zip = buildZipBytes(files)
    const dv = new DataView(zip.buffer)

    let eocdOff = -1
    for (let i = zip.length - 22; i >= 0; i--) {
      if (u32(dv, i) === 0x06054b50) { eocdOff = i; break }
    }
    expect(u16(dv, eocdOff + 8)).toBe(2)
    expect(u16(dv, eocdOff + 10)).toBe(2)
  })

  it('total byte length is deterministic for the same input', () => {
    const files = [{ name: 'img.png', data: new Uint8Array(100) }]
    expect(buildZipBytes(files).length).toBe(buildZipBytes(files).length)
  })

  it('central directory header has correct signature', () => {
    const enc = new TextEncoder()
    const name = 'file.png'
    const data = new Uint8Array([0xDE, 0xAD])
    const zip = buildZipBytes([{ name, data }])
    const dv = new DataView(zip.buffer)

    // Central directory starts right after local header + data
    const cdOff = 30 + enc.encode(name).length + data.length
    expect(u32(dv, cdOff)).toBe(0x02014b50) // CD signature
  })

  it('file with UTF-8 filename is encoded correctly', () => {
    const enc = new TextEncoder()
    const name = 'données_Q2.png'
    const nameBytes = enc.encode(name)
    const data = new Uint8Array(5)
    const zip = buildZipBytes([{ name, data }])
    const dv = new DataView(zip.buffer)

    // Filename length field in LFH
    expect(u16(dv, 26)).toBe(nameBytes.length)
    // Filename bytes in LFH
    const stored = zip.slice(30, 30 + nameBytes.length)
    expect(Array.from(stored)).toEqual(Array.from(nameBytes))
  })
})
