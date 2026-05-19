'use strict';

const fetch = require('node-fetch');

/**
 * Resolve a dotted path in an object.
 * e.g. getPath(obj, "data.deposits.items")
 */
function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Normalize rows: compute the union of all keys across every row,
 * pad missing keys with null.
 */
function normalizeRows(rows) {
  if (!rows || rows.length === 0) return rows;
  const allKeys = [];
  const keySet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keySet.has(key)) {
        keySet.add(key);
        allKeys.push(key);
      }
    }
  }
  return rows.map(row => {
    const normalized = {};
    for (const key of allKeys) {
      normalized[key] = key in row ? row[key] : null;
    }
    return normalized;
  });
}

/**
 * Inject limit/offset directly into the root field's argument list.
 * Strips any pre-existing limit:/offset: args first, then inserts before
 * the closing ) of the first field's argument block (or adds a new block
 * if the field has none). Uses paren-depth counting so nested args like
 * where:{chain:"mainnet"} are handled safely.
 */
function injectPaginationArgs(query, limit, offset) {
  // Strip any pre-existing limit/offset args
  let q = query
    .replace(/,?\s*\blimit\s*:\s*\d+/gi, '')
    .replace(/,?\s*\boffset\s*:\s*\d+/gi, '')

  const limitArg  = `limit: ${limit}`
  const offsetArg = `offset: ${offset}`

  // Find opening { of the selection set
  const selStart = q.indexOf('{')
  if (selStart === -1) return q

  // Find the first field name after {
  const tail = q.slice(selStart + 1)
  const fieldMatch = tail.match(/^\s*(\w+)/)
  if (!fieldMatch) return q

  const fieldEnd = selStart + 1 + fieldMatch.index + fieldMatch[0].length
  const afterField = q.slice(fieldEnd)
  const trimmed = afterField.trimStart()
  const spaces = afterField.length - trimmed.length

  if (trimmed.startsWith('(')) {
    // Find the matching ) by counting paren depth
    let depth = 0
    let closeIdx = -1
    for (let i = fieldEnd + spaces; i < q.length; i++) {
      if (q[i] === '(') depth++
      else if (q[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break } }
    }
    if (closeIdx === -1) return q
    return q.slice(0, closeIdx) + ` ${limitArg} ${offsetArg}` + q.slice(closeIdx)
  } else {
    // No existing args — add a new argument block after the field name
    return q.slice(0, fieldEnd) + `(${limitArg} ${offsetArg})` + q.slice(fieldEnd)
  }
}

/**
 * Main pagination engine.
 *
 * @param {string} endpoint - Validated GraphQL endpoint URL
 * @param {string} query - GraphQL query string
 * @param {object} variables - Base variables (dates, user vars) — NO pagination vars
 * @param {object} queryDef - Query definition (result_path, pagination_style, cursor_path, has_next_path)
 * @param {object} settings - Settings object (page_size, max_page_count, max_row_count, timeout_per_page_ms, warn_bytes, max_bytes)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {object} { rows, page_count, duration_ms, warnings, error_type, error_message, graphql_errors }
 */
async function fetchAllPages(endpoint, query, variables, queryDef, settings, signal) {
  const pageSize = parseInt(settings.page_size || '1000', 10);
  const maxPageCount = parseInt(settings.max_page_count || '50', 10);
  const maxRowCount = parseInt(settings.max_row_count || '50000', 10);
  const timeoutPerPage = parseInt(settings.timeout_per_page_ms || '30000', 10);
  const warnBytes = parseInt(settings.warn_bytes || '1048576', 10);
  const maxBytes = parseInt(settings.max_bytes || '10485760', 10);

  const startTime = Date.now();
  const allRows = [];
  const warnings = [];
  const graphqlErrors = [];
  let pageCount = 0;

  const { result_path, pagination_style, cursor_path, has_next_path } = queryDef;

  async function doFetch(pageVars, pageQuery = query) {
    // Create a per-page timeout signal
    const pageAbort = new AbortController();
    const timer = setTimeout(() => pageAbort.abort(), timeoutPerPage);

    // Combine with user abort signal
    let combinedSignal = pageAbort.signal;
    if (signal) {
      // If user aborts, also abort the page
      signal.addEventListener('abort', () => pageAbort.abort(), { once: true });
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: pageQuery, variables: pageVars }),
        redirect: 'error',
        signal: combinedSignal,
      });

      const data = await response.json();
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        if (signal && signal.aborted) {
          const err = new Error('Request cancelled by user.');
          err.type = 'cancelled';
          throw err;
        }
        const err = new Error(`Page fetch timed out after ${timeoutPerPage}ms.`);
        err.type = 'timeout';
        throw err;
      }
      const err = new Error(e.message);
      err.type = 'network';
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (pagination_style === 'none') {
    // Single request, no pagination vars
    const pageVars = { ...variables };
    let responseData;
    try {
      responseData = await doFetch(pageVars);
    } catch (e) {
      return {
        rows: null, page_count: 0,
        duration_ms: Date.now() - startTime,
        warnings, error_type: e.type || 'network',
        error_message: e.message, graphql_errors: null,
      };
    }

    // Handle GraphQL errors
    if (responseData.errors && !responseData.data) {
      return {
        rows: null, page_count: 0,
        duration_ms: Date.now() - startTime,
        warnings, error_type: 'graphql',
        error_message: responseData.errors.map(e => e.message).join('; '),
        graphql_errors: responseData.errors,
      };
    }

    const rows = getPath(responseData, result_path);
    if (!Array.isArray(rows)) {
      return {
        rows: null, page_count: 0,
        duration_ms: Date.now() - startTime,
        warnings, error_type: 'path_error',
        error_message: `result_path "${result_path}" did not resolve to an array.`,
        graphql_errors: null,
      };
    }

    pageCount = 1;
    const normalized = normalizeRows(rows);
    const sizeBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');

    if (sizeBytes > maxBytes) {
      return {
        rows: null, page_count: pageCount,
        duration_ms: Date.now() - startTime,
        warnings, error_type: 'size_limit',
        error_message: `Result size (${sizeBytes} bytes) exceeds max_bytes (${maxBytes}).`,
        graphql_errors: null,
      };
    }

    if (sizeBytes > warnBytes) {
      warnings.push(`Result size (${sizeBytes} bytes) exceeds warn_bytes (${warnBytes}).`);
    }

    let partialErrors = null;
    if (responseData.errors) {
      partialErrors = responseData.errors;
    }

    return {
      rows: normalized, page_count: pageCount,
      duration_ms: Date.now() - startTime,
      warnings,
      error_type: partialErrors ? 'graphql_partial' : null,
      error_message: partialErrors ? partialErrors.map(e => e.message).join('; ') : null,
      graphql_errors: partialErrors,
    };

  } else if (pagination_style === 'offset') {
    let skip = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal && signal.aborted) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'cancelled',
          error_message: 'Request cancelled by user.', graphql_errors: null,
        };
      }

      const pagedQuery = injectPaginationArgs(query, pageSize, skip);
      const pageVars = { ...variables };
      let responseData;
      try {
        responseData = await doFetch(pageVars, pagedQuery);
      } catch (e) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: e.type || 'network',
          error_message: e.message, graphql_errors: null,
        };
      }

      // Handle GraphQL errors — no data at all
      if (responseData.errors && !responseData.data) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'graphql',
          error_message: responseData.errors.map(e => e.message).join('; '),
          graphql_errors: responseData.errors,
        };
      }

      const rows = getPath(responseData, result_path);
      if (!Array.isArray(rows)) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'path_error',
          error_message: `result_path "${result_path}" did not resolve to an array.`,
          graphql_errors: null,
        };
      }

      // max_row_count check BEFORE append
      if (allRows.length + rows.length > maxRowCount) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'row_limit',
          error_message: `Row count would exceed max_row_count (${maxRowCount}). Fetched ${allRows.length} rows so far.`,
          graphql_errors: null,
        };
      }

      // graphql_partial: data + errors on same page
      if (responseData.errors && responseData.data) {
        // Include rows from this partial page
        for (const row of rows) allRows.push(row);
        for (const e of responseData.errors) graphqlErrors.push(e);
        pageCount++;
        // Stop immediately
        const normalized = normalizeRows(allRows);
        return {
          rows: normalized, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'graphql_partial',
          error_message: graphqlErrors.map(e => e.message).join('; '),
          graphql_errors: graphqlErrors,
        };
      }

      for (const row of rows) allRows.push(row);
      pageCount++;

      // max_page_count check AFTER increment
      if (pageCount > maxPageCount) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'page_limit',
          error_message: `Page count exceeded max_page_count (${maxPageCount}).`,
          graphql_errors: null,
        };
      }

      if (rows.length < pageSize) {
        // Last page
        break;
      }
      skip += pageSize;
    }

  } else if (pagination_style === 'cursor') {
    let after = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal && signal.aborted) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'cancelled',
          error_message: 'Request cancelled by user.', graphql_errors: null,
        };
      }

      const pageVars = { ...variables, first: pageSize, after };
      let responseData;
      try {
        responseData = await doFetch(pageVars);
      } catch (e) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: e.type || 'network',
          error_message: e.message, graphql_errors: null,
        };
      }

      if (responseData.errors && !responseData.data) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'graphql',
          error_message: responseData.errors.map(e => e.message).join('; '),
          graphql_errors: responseData.errors,
        };
      }

      const rows = getPath(responseData, result_path);
      if (!Array.isArray(rows)) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'path_error',
          error_message: `result_path "${result_path}" did not resolve to an array.`,
          graphql_errors: null,
        };
      }

      const hasNext = getPath(responseData, has_next_path);
      const cursor = getPath(responseData, cursor_path);

      // max_row_count check BEFORE append
      if (allRows.length + rows.length > maxRowCount) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'row_limit',
          error_message: `Row count would exceed max_row_count (${maxRowCount}). Fetched ${allRows.length} rows so far.`,
          graphql_errors: null,
        };
      }

      // graphql_partial: data + errors on same page
      if (responseData.errors && responseData.data) {
        for (const row of rows) allRows.push(row);
        for (const e of responseData.errors) graphqlErrors.push(e);
        pageCount++;
        const normalized = normalizeRows(allRows);
        return {
          rows: normalized, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'graphql_partial',
          error_message: graphqlErrors.map(e => e.message).join('; '),
          graphql_errors: graphqlErrors,
        };
      }

      for (const row of rows) allRows.push(row);
      pageCount++;

      // max_page_count check AFTER increment
      if (pageCount > maxPageCount) {
        return {
          rows: null, page_count: pageCount,
          duration_ms: Date.now() - startTime,
          warnings, error_type: 'page_limit',
          error_message: `Page count exceeded max_page_count (${maxPageCount}).`,
          graphql_errors: null,
        };
      }

      if (!hasNext) {
        break;
      }
      after = cursor;
    }
  } else {
    return {
      rows: null, page_count: 0,
      duration_ms: Date.now() - startTime,
      warnings, error_type: 'invalid_query',
      error_message: `Unknown pagination_style: "${pagination_style}"`,
      graphql_errors: null,
    };
  }

  // Normalize rows after full collection
  const normalized = normalizeRows(allRows);

  // Size check
  const sizeBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');

  if (sizeBytes > maxBytes) {
    return {
      rows: null, page_count: pageCount,
      duration_ms: Date.now() - startTime,
      warnings, error_type: 'size_limit',
      error_message: `Result size (${sizeBytes} bytes) exceeds max_bytes (${maxBytes}).`,
      graphql_errors: null,
    };
  }

  if (sizeBytes > warnBytes) {
    warnings.push(`Result size (${sizeBytes} bytes) exceeds warn_bytes (${warnBytes}).`);
  }

  return {
    rows: normalized,
    page_count: pageCount,
    duration_ms: Date.now() - startTime,
    warnings,
    error_type: graphqlErrors.length > 0 ? 'graphql_partial' : null,
    error_message: graphqlErrors.length > 0 ? graphqlErrors.map(e => e.message).join('; ') : null,
    graphql_errors: graphqlErrors.length > 0 ? graphqlErrors : null,
  };
}

module.exports = { fetchAllPages, normalizeRows, getPath };
