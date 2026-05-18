'use strict';

const dns = require('dns');
const ipaddr = require('ipaddr.js');

const BLOCKED_PORTS = new Set([22, 25, 465, 587]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Check if an IP address string falls in a private/reserved range.
 * Returns true if blocked, false if allowed.
 */
function isPrivateIp(address) {
  try {
    const parsed = ipaddr.parse(address);
    const range = parsed.range();
    // Blocked ranges
    const blockedRanges = [
      'private',
      'loopback',
      'linkLocal',
      'uniqueLocal',
      'broadcast',
      'carrierGradeNat',
      'reserved',
      'unspecified',
    ];
    return blockedRanges.includes(range);
  } catch (e) {
    // If we can't parse, treat as blocked
    return true;
  }
}

/**
 * Core URL validation logic.
 * Returns null if valid, or an error message string if invalid.
 */
async function validateUrl(url) {
  // Step 1: Parse URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return 'Invalid URL: ' + e.message;
  }

  // Step 2: Allow only https: or http:
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Scheme "${parsed.protocol}" is not allowed. Only http: and https: are permitted.`;
  }

  // Step 5: Reject credentials
  if (parsed.username || parsed.password) {
    return 'URLs with credentials (user:pass@host) are not allowed.';
  }

  // Step 6: Reject blocked ports
  const port = parsed.port ? parseInt(parsed.port, 10) : null;
  if (port !== null && BLOCKED_PORTS.has(port)) {
    return `Port ${port} is blocked.`;
  }

  const hostname = parsed.hostname;

  // Step 3: For http:, only allow loopback
  if (parsed.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(hostname)) {
      // Check if it's a numeric loopback IP like 127.x.x.x
      let isLoopback = false;
      try {
        const ip = ipaddr.parse(hostname);
        isLoopback = ip.range() === 'loopback';
      } catch (e) {
        // hostname is not a bare IP, and not in LOOPBACK_HOSTS set
        isLoopback = false;
      }
      if (!isLoopback) {
        return `http: is only allowed for loopback addresses. Use https: for remote endpoints.`;
      }
    }
    // Loopback HTTP is allowed; no further checks needed
    return null;
  }

  // Step 4: For https:, reject private IP ranges
  // First check if hostname is already an IP
  let hostnameIsIp = false;
  try {
    ipaddr.parse(hostname);
    hostnameIsIp = true;
  } catch (e) {
    hostnameIsIp = false;
  }

  if (hostnameIsIp) {
    if (isPrivateIp(hostname)) {
      return `IP address "${hostname}" is in a private/reserved range and is not allowed.`;
    }
    // Public IP is fine
    return null;
  }

  // Step 7: DNS resolution for non-loopback hostnames
  // (loopback hostnames like 'localhost' are already handled above for http:)
  // For https: with a hostname, resolve DNS
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (e) {
    return `DNS resolution failed for "${hostname}": ${e.message}`;
  }

  if (!addresses || addresses.length === 0) {
    return `DNS resolution returned no addresses for "${hostname}".`;
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      return `Hostname "${hostname}" resolves to private/reserved IP "${address}", which is not allowed (DNS rebinding protection).`;
    }
  }

  return null;
}

/**
 * Express middleware that validates the endpoint URL.
 * Reads endpoint from req.body.endpoint, req.query.endpoint, or settings.
 */
function validateEndpoint(db) {
  return async function validateEndpointMiddleware(req, res, next) {
    // Determine the endpoint URL to validate
    let endpoint =
      (req.body && req.body.endpoint) ||
      req.query.endpoint ||
      null;

    if (!endpoint) {
      // Fall back to stored settings endpoint
      try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('endpoint');
        endpoint = row ? row.value : null;
      } catch (e) {
        // DB error — proceed without endpoint for routes that don't need it
      }
    }

    if (!endpoint) {
      return res.status(400).json({
        error: 'invalid_endpoint',
        message: 'No endpoint configured. Set an endpoint in settings.',
      });
    }

    const errorMsg = await validateUrl(endpoint);
    if (errorMsg) {
      return res.status(400).json({
        error: 'invalid_endpoint',
        message: errorMsg,
      });
    }

    // Attach validated endpoint to request for use in route handlers
    req.validatedEndpoint = endpoint;
    next();
  };
}

module.exports = { validateEndpoint, validateUrl };
