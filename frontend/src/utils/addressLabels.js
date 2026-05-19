export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Build a two-level lookup: address (lowercase) → chain → name */
export function buildAddressMap(addressLabels) {
  const map = new Map()
  for (const label of addressLabels) {
    const addr = label.address.toLowerCase()
    if (!map.has(addr)) map.set(addr, new Map())
    map.get(addr).set(label.chain, label.name)
  }
  return map
}

/**
 * Resolve a raw value against the address map.
 * Returns the label name if found, or null.
 * Falls back to chain='' (chain-agnostic) if no exact chain match.
 */
export function resolveAddress(value, chain, addressMap) {
  if (!ADDRESS_RE.test(value)) return null
  const chainMap = addressMap.get(value.toLowerCase())
  if (!chainMap) return null
  return chainMap.get(chain) ?? chainMap.get('') ?? null
}
