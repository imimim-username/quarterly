/**
 * utils/zipBuilder.js — Pure-JS STORE-mode ZIP builder (no dependencies).
 *
 * Used as the PNG export fallback for browsers without showDirectoryPicker
 * (Firefox, Safari). PNGs are already compressed; STORE mode avoids the
 * complexity of a DEFLATE implementation and wastes no space.
 */

/** CRC-32 lookup table — initialised once. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

/**
 * Compute the CRC-32 checksum of a Uint8Array.
 * @param {Uint8Array} data
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(data) {
  let crc = 0xFFFFFFFF
  for (const b of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF]
  return (~crc) >>> 0
}

/**
 * Build a ZIP Uint8Array from an array of named file entries.
 * All files are stored uncompressed (method 0 / STORE).
 *
 * @param {Array<{ name: string, data: Uint8Array }>} files
 * @returns {Uint8Array}
 */
export function buildZipBytes(files) {
  const enc = new TextEncoder()
  const localParts = []   // interleaved local headers + file data
  const centralParts = [] // central directory headers
  let offset = 0

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name)
    const crc = crc32(data)
    const size = data.length

    // ── Local file header (30 + filename bytes) ──────────────────────────────
    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32( 0, 0x04034b50, true)        // signature  PK\x03\x04
    lv.setUint16( 4, 20,         true)        // version needed (2.0)
    lv.setUint16( 6, 0,          true)        // general-purpose flags
    lv.setUint16( 8, 0,          true)        // compression method: STORE
    lv.setUint16(10, 0,          true)        // last-mod time
    lv.setUint16(12, 0,          true)        // last-mod date
    lv.setUint32(14, crc,        true)        // CRC-32
    lv.setUint32(18, size,       true)        // compressed size
    lv.setUint32(22, size,       true)        // uncompressed size
    lv.setUint16(26, nameBytes.length, true)  // filename length
    lv.setUint16(28, 0,          true)        // extra field length
    lh.set(nameBytes, 30)

    // ── Central directory header (46 + filename bytes) ───────────────────────
    const ch = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32( 0, 0x02014b50, true)        // signature  PK\x01\x02
    cv.setUint16( 4, 20,         true)        // version made by
    cv.setUint16( 6, 20,         true)        // version needed
    cv.setUint16( 8, 0,          true)        // flags
    cv.setUint16(10, 0,          true)        // compression
    cv.setUint16(12, 0,          true)        // mod time
    cv.setUint16(14, 0,          true)        // mod date
    cv.setUint32(16, crc,        true)        // CRC-32
    cv.setUint32(20, size,       true)        // compressed size
    cv.setUint32(24, size,       true)        // uncompressed size
    cv.setUint16(28, nameBytes.length, true)  // filename length
    cv.setUint16(30, 0,          true)        // extra field length
    cv.setUint16(32, 0,          true)        // file comment length
    cv.setUint16(34, 0,          true)        // disk number start
    cv.setUint16(36, 0,          true)        // internal attributes
    cv.setUint32(38, 0,          true)        // external attributes
    cv.setUint32(42, offset,     true)        // relative offset of local header
    ch.set(nameBytes, 46)

    localParts.push(lh, data)
    centralParts.push(ch)
    offset += 30 + nameBytes.length + size
  }

  // ── End of central directory record (22 bytes) ───────────────────────────────
  const cdOffset = offset
  const cdSize = centralParts.reduce((s, p) => s + p.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32( 0, 0x06054b50,   true)  // signature  PK\x05\x06
  ev.setUint16( 4, 0,            true)  // disk number
  ev.setUint16( 6, 0,            true)  // disk with start of central directory
  ev.setUint16( 8, files.length, true)  // entries on this disk
  ev.setUint16(10, files.length, true)  // total entries
  ev.setUint32(12, cdSize,       true)  // central directory size (bytes)
  ev.setUint32(16, cdOffset,     true)  // central directory offset
  ev.setUint16(20, 0,            true)  // ZIP file comment length

  // ── Concatenate everything ───────────────────────────────────────────────────
  const all = [...localParts, ...centralParts, eocd]
  const total = all.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of all) { out.set(p, pos); pos += p.length }
  return out
}
