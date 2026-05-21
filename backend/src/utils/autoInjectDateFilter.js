'use strict';

/**
 * Attempt to auto-inject timestamp where-clause filters into a GraphQL query string.
 *
 * Used when a query has no global_start / global_end variable_defs configured but
 * the user supplies a start_date / end_date on a run.  Follows the Ponder v1
 * convention: BigInt timestamps, *_gte / *_lte filter field names.
 *
 * The approach:
 *   1. Inject `$timestamp_gte` / `$timestamp_lte` variable declarations into the
 *      query signature  (e.g.  `query Foo {`  →  `query Foo($timestamp_gte: BigInt) {`).
 *   2. Inject `where: { timestamp_gte: $timestamp_gte, … }` as the *first* argument
 *      of the first top-level selection field (prepended before any existing args).
 *
 * The caller is responsible for falling back to the original query if the injected
 * query returns a GraphQL error.
 *
 * @param {string}      gql        - Original GraphQL query string.
 * @param {string|null} startDate  - ISO date string or null.
 * @param {string|null} endDate    - ISO date string or null.
 * @param {string}      dateFormat - 'unix_seconds' | 'unix_ms' | 'iso8601'
 * @returns {{ gql: string, extraVars: object, injected: boolean }}
 */
function autoInjectDateFilter(gql, startDate, endDate, dateFormat) {
  const extraVars = {};
  const varDecls  = [];
  const whereFields = [];

  // Convert an ISO date string to the appropriate scalar value.
  function toValue(dateStr) {
    const d = new Date(dateStr);
    if (dateFormat === 'unix_ms')  return d.getTime();
    if (dateFormat === 'iso8601') return d.toISOString();
    return Math.floor(d.getTime() / 1000); // unix_seconds (default / Ponder convention)
  }

  // Pick GraphQL scalar type to declare.
  const gqlType = dateFormat === 'iso8601' ? 'String' : 'BigInt';

  if (startDate) {
    extraVars.timestamp_gte = toValue(startDate);
    varDecls.push(`$timestamp_gte: ${gqlType}`);
    whereFields.push('timestamp_gte: $timestamp_gte');
  }
  if (endDate) {
    extraVars.timestamp_lte = toValue(endDate);
    varDecls.push(`$timestamp_lte: ${gqlType}`);
    whereFields.push('timestamp_lte: $timestamp_lte');
  }

  if (varDecls.length === 0) {
    return { gql, extraVars: {}, injected: false };
  }

  const whereArg   = `where: { ${whereFields.join(', ')} }`;
  const varDeclStr = varDecls.join(', ');

  // ── Step 1: inject variable declarations into the query signature ─────────
  // Handles:  query Name {          →  query Name($ts_gte: BigInt) {
  //           query Name(existing) { →  query Name(existing, $ts_gte: BigInt) {
  //           query {               →  query($ts_gte: BigInt) {
  let modified = gql.replace(
    /(\bquery\b\s*(?:\w+)?)\s*(?:\(([^)]*)\))?\s*\{/,
    (_, keyword, existingVars) => {
      const allVars = [existingVars, varDeclStr].filter(Boolean).join(', ');
      return `${keyword.trimEnd()}(${allVars}) {`;
    }
  );

  if (modified === gql) {
    // Regex found nothing — query has no `query` keyword; bail out.
    return { gql, extraVars: {}, injected: false };
  }

  // ── Step 2: locate the opening brace of the query body ───────────────────
  // After step 1 the first `{` in the string is the query body's opening brace.
  // Variable type declarations (BigInt, String) never contain `{`.
  const openBrace = modified.indexOf('{');
  if (openBrace === -1) return { gql, extraVars: {}, injected: false };

  // ── Step 3: skip whitespace to reach the first field name ─────────────────
  let pos = openBrace + 1;
  while (pos < modified.length && /\s/.test(modified[pos])) pos++;
  if (pos >= modified.length) return { gql, extraVars: {}, injected: false };

  // ── Step 4: skip over the field name (word characters) ────────────────────
  while (pos < modified.length && /\w/.test(modified[pos])) pos++;

  // Remember the position immediately after the last field-name character.
  // Used as the insertion point when the field has no existing args.
  const afterFieldName = pos;

  // ── Step 5: skip horizontal whitespace only (spaces / tabs, not newlines) ─
  while (pos < modified.length && (modified[pos] === ' ' || modified[pos] === '\t')) pos++;

  // ── Step 6: inject the where clause ───────────────────────────────────────
  let injectedGql;

  if (modified[pos] === '(') {
    // Field already has arguments — prepend the where clause inside the parens.
    injectedGql =
      modified.slice(0, pos + 1) +
      whereArg + ', ' +
      modified.slice(pos + 1);

  } else if (
    modified[pos] === '{' ||
    modified[pos] === '\n' ||
    modified[pos] === '\r' ||
    pos >= modified.length
  ) {
    // Field has no arguments — insert (whereArg) directly after the field name,
    // before any trailing spaces, so we get `fieldName(where: …) {` (no gap).
    injectedGql =
      modified.slice(0, afterFieldName) +
      '(' + whereArg + ')' +
      modified.slice(afterFieldName);

  } else {
    // Unexpected character; bail out safely.
    return { gql, extraVars: {}, injected: false };
  }

  return { gql: injectedGql, extraVars, injected: true };
}

module.exports = { autoInjectDateFilter };
