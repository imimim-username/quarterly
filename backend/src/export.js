'use strict';

const { stringify } = require('csv-stringify/sync');

const FORMULA_CHARS = new Set(['=', '+', '-', '@']);

/**
 * Prefix CSV formula injection characters with a single quote.
 */
function sanitizeCsvCell(value) {
  if (typeof value === 'string' && value.length > 0 && FORMULA_CHARS.has(value[0])) {
    return "'" + value;
  }
  return value;
}

/**
 * Scale a raw BigInt-like string by decimals.
 * Uses abs() for fractional part to avoid sign issues.
 */
function scaledDecimal(rawValue, decimals) {
  const raw = BigInt(rawValue);
  const d = BigInt(decimals);
  const divisor = 10n ** d;
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const intPart = abs / divisor;
  const fracRaw = (abs % divisor).toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  const magnitude = fracRaw.length > 0 ? `${intPart}.${fracRaw}` : `${intPart}`;
  return negative ? `-${magnitude}` : magnitude;
}

/**
 * Format a unix timestamp (seconds) as ISO8601.
 */
function formatTimestamp(value) {
  const n = Number(value);
  if (isNaN(n)) return value;
  return new Date(n * 1000).toISOString();
}

/**
 * Flatten a single row object into a flat key-value map.
 * Handles nested objects (dot-notation to depth 3) and nested arrays (expansion).
 * Returns an array of flat objects (one row becomes multiple if it has a nested array).
 */
function flattenRow(row, fieldMeta, depth = 0) {
  const result = {};
  const arrayFields = [];

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value !== 'object') {
      // Scalar
      result[key] = applyFieldMeta(key, value, fieldMeta);
    } else if (Array.isArray(value)) {
      // Nested array — handle after scalar fields
      arrayFields.push({ key, value });
    } else {
      // Nested object — dot notation up to depth 3
      if (depth >= 2) {
        // depth 3 and beyond: serialize as JSON string
        result[key] = JSON.stringify(value);
      } else {
        const nested = flattenRow(value, fieldMeta, depth + 1);
        // nested is always a single-element array for objects
        for (const [nk, nv] of Object.entries(nested[0])) {
          result[`${key}_${nk}`] = nv;
        }
      }
    }
  }

  if (arrayFields.length === 0) {
    return [result];
  }

  // Expand array fields — multiplicative
  let expanded = [result];
  for (const { key, value: arr } of arrayFields) {
    const newExpanded = [];
    for (const baseRow of expanded) {
      if (arr.length === 0) {
        newExpanded.push({ ...baseRow });
      } else {
        for (const elem of arr) {
          if (elem !== null && typeof elem === 'object' && !Array.isArray(elem)) {
            const elemFlattened = flattenRow(elem, fieldMeta, depth + 1);
            for (const flatElem of elemFlattened) {
              const merged = { ...baseRow };
              for (const [ek, ev] of Object.entries(flatElem)) {
                merged[`${key}_${ek}`] = ev;
              }
              newExpanded.push(merged);
            }
          } else {
            newExpanded.push({ ...baseRow, [key]: applyFieldMeta(key, elem, fieldMeta) });
          }
        }
      }
    }
    expanded = newExpanded;
  }

  return expanded;
}

/**
 * Apply field metadata transformations (decimal scaling, timestamp formatting).
 */
function applyFieldMeta(fieldName, value, fieldMeta) {
  if (!fieldMeta || !fieldMeta[fieldName]) return value;

  const meta = fieldMeta[fieldName];

  if (meta.decimals !== undefined && value !== null && value !== undefined) {
    try {
      return scaledDecimal(String(value), meta.decimals);
    } catch (e) {
      return value; // Return raw if BigInt conversion fails
    }
  }

  if (meta.type === 'unix_seconds' && value !== null && value !== undefined) {
    return formatTimestamp(value);
  }

  return value;
}

/**
 * Compute column order: key field first, then insertion order of first row;
 * keys appearing only in later rows appended in first-seen order.
 */
function computeColumnOrder(rows, keyField) {
  const columns = [];
  const seen = new Set();

  // Key field first
  if (keyField) {
    columns.push(keyField);
    seen.add(keyField);
  }

  // Then insertion order of first row
  if (rows.length > 0) {
    for (const key of Object.keys(rows[0])) {
      if (!seen.has(key)) {
        columns.push(key);
        seen.add(key);
      }
    }
  }

  // Then any keys from subsequent rows
  for (const row of rows.slice(1)) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        columns.push(key);
        seen.add(key);
      }
    }
  }

  return columns;
}

/**
 * Export rows as a JSON string.
 */
function toJson(rows) {
  return JSON.stringify(rows, null, 2);
}

/**
 * Export rows as a CSV string.
 * @param {Array} rows - Raw row objects from the run
 * @param {object} fieldMeta - Field metadata from query definition
 * @param {string} keyField - Key field name
 */
function toCsv(rows, fieldMeta, keyField) {
  if (!rows || rows.length === 0) {
    return '';
  }

  // Flatten all rows
  const flatRows = [];
  for (const row of rows) {
    const expanded = flattenRow(row, fieldMeta || {}, 0);
    for (const flat of expanded) {
      flatRows.push(flat);
    }
  }

  if (flatRows.length === 0) return '';

  const columns = computeColumnOrder(flatRows, keyField);

  // Build CSV records — apply formula injection protection
  const records = flatRows.map(row => {
    const record = {};
    for (const col of columns) {
      const val = col in row ? row[col] : null;
      record[col] = sanitizeCsvCell(val === null || val === undefined ? '' : String(val));
    }
    return record;
  });

  return stringify(records, {
    header: true,
    columns,
  });
}

module.exports = { toJson, toCsv, scaledDecimal, flattenRow, computeColumnOrder };
