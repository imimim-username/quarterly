# quarterly — Full Project Context

This document is the authoritative technical reference for the **quarterly** project. It covers every file, implementation pattern, data flow, schema, API shape, component contract, and design decision in the codebase. Intended for developers and AI assistants picking up this project cold.

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [Running the Project](#4-running-the-project)
5. [Database Schema](#5-database-schema)
6. [Migration System](#6-migration-system)
7. [Backend — Core Modules](#7-backend--core-modules)
8. [Backend — All Routes](#8-backend--all-routes)
9. [Frontend — App.jsx State & Data Flow](#9-frontend--appjsx-state--data-flow)
10. [Frontend — Component Contracts](#10-frontend--component-contracts)
11. [Frontend API Client](#11-frontend-api-client)
12. [Key Implementation Details](#12-key-implementation-details)
13. [Testing](#13-testing)
14. [CSS / Theme Variables](#14-css--theme-variables)
15. [Deployment Notes](#15-deployment-notes)

---

## 1. Project Purpose

**quarterly** is a localhost-only web dashboard for running and comparing GraphQL queries against a [Ponder](https://ponder.sh/) blockchain indexing endpoint. It was built for Alchemix v3 on-chain quarterly reporting but works with any Ponder-compatible API.

Core loop:
1. User pastes a Ponder endpoint URL
2. User picks a date range
3. User runs a named query → results saved to SQLite
4. User compares runs across quarters or exports to CSV/ZIP

All data lives locally in a single SQLite file. There is no cloud component.

---

## 2. Repository Layout

```
quarterly/                          npm workspace root
├── package.json                    workspace config; `npm run dev` and `npm test`
├── README.md                       user-facing documentation
├── PLAN.md                         original implementation spec (historical)
├── context/
│   └── project-context.md          ← this file
├── backend/
│   ├── package.json                name: quarterly-backend, version: 1.0.0
│   ├── src/
│   │   ├── server.js               Express entry point, binds 127.0.0.1:8790
│   │   ├── db.js                   SQLite init + migration runner
│   │   ├── ponder.js               GraphQL fetch + auto-pagination engine
│   │   ├── export.js               JSON/CSV/ZIP serialisation helpers
│   │   ├── middleware/
│   │   │   └── validateEndpoint.js SSRF protection middleware
│   │   ├── migrations/
│   │   │   ├── 001_initial.js      baseline schema (all core tables + settings defaults)
│   │   │   ├── 002_address_labels.js  address_labels table
│   │   │   ├── 003_chart_views.js  ALTER queries ADD COLUMN chart_views
│   │   │   └── 004_endpoints_and_run_notes.js  endpoints table + runs.notes column
│   │   └── routes/
│   │       ├── settings.js
│   │       ├── queries.js
│   │       ├── runs.js
│   │       ├── reports.js
│   │       ├── export.js
│   │       ├── introspect.js
│   │       ├── proxy.js
│   │       ├── addressLabels.js
│   │       ├── transfer.js
│   │       └── endpoints.js
│   ├── data/
│   │   └── quarterly.db            SQLite database (gitignored)
│   └── tests/
│       ├── validateEndpoint.test.js
│       ├── ponder.test.js
│       ├── export.test.js
│       ├── queries.test.js
│       ├── runs.test.js
│       ├── settings.test.js
│       └── endpoints.test.js
├── frontend/
│   ├── package.json                name: quarterly-frontend, version: 1.0.0
│   ├── vite.config.js              dev proxy /api → http://127.0.0.1:8790
│   ├── vitest.config.js            jsdom environment, @testing-library/jest-dom setup
│   └── src/
│       ├── main.jsx                ReactDOM.createRoot mount
│       ├── App.jsx                 root component, all top-level state
│       ├── api/
│       │   └── client.js           all fetch helpers (named exports)
│       ├── utils/
│       │   └── addressLabels.js    buildAddressMap / resolveAddress utilities
│       └── components/             20 components (see §10)
│           ├── __tests__/          7 Vitest test files
│           └── ...
└── queries/
    └── builtin/
        ├── myt_deposits.json
        ├── alchemist_deposits.json
        └── user_counts.json
```

---

## 3. Tech Stack

### Backend

| Library | Version | Role |
|---|---|---|
| Node.js | 20+ | runtime |
| Express | 4.22.2 | HTTP server |
| better-sqlite3 | 12.10.0 | SQLite driver (native C++ addon) |
| node-fetch | 2.7.0 | GraphQL HTTP client |
| csv-stringify | 6.7.0 | CSV generation |
| archiver | 7.0.1 | ZIP creation |
| ipaddr.js | 2.4.0 | IP range classification for SSRF protection |
| Jest | 29.7.0 | test runner |
| supertest | 7.2.2 | HTTP test assertions |
| nock | 13.5.6 | HTTP mocking in tests |

### Frontend

| Library | Version | Role |
|---|---|---|
| React | 18.3.1 | UI framework |
| Vite | 6.4.2 | build tool + dev server |
| ECharts | 5.6.0 | charts |
| @uiw/react-codemirror | 4.25.9 | GraphQL code editor |
| @codemirror/lang-javascript | 6.2.5 | syntax highlighting |
| @tanstack/react-virtual | 3.13.24 | virtual scrolling for large tables |
| graphiql | 3.7.1 | embedded GraphQL explorer |
| @graphiql/plugin-explorer | 3.2.3 | field explorer plugin |
| react-datepicker | 7.6.0 | date pickers |
| Vitest | 3.1.4 | frontend test runner |
| @testing-library/react | 16.3.0 | component test helpers |
| @testing-library/jest-dom | 6.6.3 | DOM matchers |

---

## 4. Running the Project

### Dev mode (both servers)
```bash
npm run dev
# → backend on http://127.0.0.1:8790
# → frontend on http://localhost:5173
```

### Backend only
```bash
npm run dev --workspace=backend
# uses node --watch src/server.js
```

### Frontend only
```bash
npm run dev --workspace=frontend
# vite dev server with /api proxy to :8790
```

### Tests
```bash
npm test                          # backend Jest tests
npm test --workspace=frontend     # frontend Vitest tests
```

### Build frontend
```bash
npm run build --workspace=frontend
# outputs to frontend/dist/
```

---

## 5. Database Schema

Single SQLite file at `backend/data/quarterly.db`. WAL mode enabled. Foreign keys enforced.

### `settings`
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Default rows (inserted by migration 001 if absent):

| key | default |
|---|---|
| endpoint | `` (empty) |
| warn_bytes | `1048576` |
| max_bytes | `10485760` |
| page_size | `1000` |
| max_page_count | `50` |
| max_row_count | `50000` |
| timeout_per_page_ms | `30000` |
| builtin_imported | `0` |

### `queries`
```sql
CREATE TABLE queries (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  category         TEXT    NOT NULL DEFAULT 'General',
  gql              TEXT    NOT NULL,
  variable_defs    TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  result_path      TEXT    NOT NULL,                -- dotted path, e.g. "data.deposits"
  pagination_style TEXT    NOT NULL DEFAULT 'offset',
  cursor_path      TEXT    NOT NULL DEFAULT '',
  has_next_path    TEXT    NOT NULL DEFAULT '',
  date_format      TEXT    NOT NULL DEFAULT 'unix_seconds',
  chain_mode       TEXT    NOT NULL DEFAULT 'filter',
  chain_var_name   TEXT    NOT NULL DEFAULT 'chain',
  chain_field      TEXT    NOT NULL DEFAULT 'chain',
  field_meta       TEXT    NOT NULL DEFAULT '{}',   -- JSON object
  key_field        TEXT    NOT NULL DEFAULT 'id',
  is_builtin       INTEGER NOT NULL DEFAULT 0,
  chart_views      TEXT    NOT NULL DEFAULT '[]',   -- JSON array (added migration 003)
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
```

**JSON fields** (parsed by routes before returning to clients):
- `variable_defs` — array of `{ name, source, default?, type? }`
- `field_meta` — object of `{ [columnName]: { label?, decimals?, type?, unit? } }`
- `chart_views` — array of chart view snapshot objects

**Validation rules (enforced in routes/queries.js):**
- `name`, `gql`, `result_path` are required
- `pagination_style` must be one of `offset`, `cursor`, `none`
- If `cursor`: `cursor_path` and `has_next_path` must be non-empty
- `variable_defs` must be a JSON array
- `field_meta` must be a JSON object

### `runs`
```sql
CREATE TABLE runs (
  id             INTEGER PRIMARY KEY,
  query_id       INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  endpoint       TEXT    NOT NULL,
  start_date     TEXT,                  -- ISO 8601 or null
  end_date       TEXT,                  -- ISO 8601 or null
  variables_base TEXT    NOT NULL,      -- JSON object (user/date vars, no pagination)
  rows           TEXT,                  -- JSON array of row objects (null on error)
  row_count      INTEGER NOT NULL DEFAULT 0,
  page_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  error_type     TEXT,                  -- null | 'graphql_partial' on saved runs
  error_message  TEXT,
  graphql_errors TEXT,                  -- JSON array or null
  warnings       TEXT,                  -- JSON array of strings
  notes          TEXT,                  -- free text, added migration 004
  ran_at         TEXT    NOT NULL       -- ISO 8601
);
CREATE INDEX idx_runs_query  ON runs(query_id, ran_at);
CREATE INDEX idx_runs_ran_at ON runs(ran_at);
```

**Save policy:** only runs with `error_type IS NULL` or `error_type = 'graphql_partial'` are saved to the DB. Network, timeout, size, and pure GraphQL errors return a response but are not persisted.

### `reports`
```sql
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
```

### `report_queries`
```sql
CREATE TABLE report_queries (
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  query_id   INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (report_id, query_id)
);
```

### `report_runs`
```sql
CREATE TABLE report_runs (
  id         INTEGER PRIMARY KEY,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date   TEXT,
  endpoint   TEXT    NOT NULL,
  ran_at     TEXT    NOT NULL
);
```

### `report_run_queries`
```sql
CREATE TABLE report_run_queries (
  report_run_id INTEGER NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  query_id      INTEGER NOT NULL REFERENCES queries(id),
  run_id        INTEGER REFERENCES runs(id),
  status        TEXT    NOT NULL DEFAULT 'pending',  -- 'ok' | 'failed'
  error_message TEXT,
  PRIMARY KEY (report_run_id, query_id)
);
```

### `address_labels`
```sql
CREATE TABLE address_labels (
  id          INTEGER PRIMARY KEY,
  address     TEXT NOT NULL,
  chain       TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(address, chain)
);
CREATE INDEX idx_address_labels_address ON address_labels(address);
```

Uniqueness key is `(address, chain)`. A chain-agnostic entry uses `chain = ''`.

### `endpoints`
```sql
CREATE TABLE endpoints (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  url        TEXT    NOT NULL DEFAULT '',
  headers    TEXT    NOT NULL DEFAULT '{}',  -- JSON object
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
```

### `schema_version`
```sql
CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL
);
```

Used by the migration runner. Tracks the highest applied migration number.

---

## 6. Migration System

**File:** `backend/src/db.js`

- On startup, reads `MAX(version)` from `schema_version`
- Scans `src/migrations/` for files matching `/^\d{3}_.*\.js$/`, sorted ascending
- Applies any migration with `versionNum > currentVersion` in a transaction
- Each migration exports `{ up(db) }` — a synchronous function that runs SQL against the db instance
- Applied migrations are never rolled back

**Adding a migration:** create `backend/src/migrations/005_my_change.js` with `module.exports = { up(db) { db.exec('...') } }`. It runs automatically on next server start.

---

## 7. Backend — Core Modules

### `server.js`

- Creates Express app with `express.json({ limit: '50mb' })`
- Registers all 10 route modules on `/api/*`
- Binds to `127.0.0.1:PORT` (PORT default 8790, overridable via env)
- Global error handler → `{ error: 'server_error', message }`
- Health check: `GET /api/health` → `{ ok: true, version: '1.0.0' }`
- Exports `{ app, server }` for test usage

### `db.js`

- Opens SQLite at `backend/data/quarterly.db` (creates directory if missing)
- Sets `journal_mode = WAL` and `foreign_keys = ON` as first pragmas
- Runs migration system (see §6)
- Exports the db instance (singleton — all route modules receive it as a function argument)

### `ponder.js`

The core pagination engine. Exports `{ fetchAllPages, normalizeRows, getPath }`.

#### `getPath(obj, dotPath)`
Traverses a nested object by dotted string path. Returns `undefined` on any missing node.

#### `normalizeRows(rows)`
Computes the union of all keys across every row, then pads missing keys with `null`. Ensures all rows have identical column sets.

#### `injectPaginationArgs(query, limit, offset)`
String-manipulates a GraphQL query string to inject `limit: N offset: M` into the first field's argument block. Does paren-depth counting so nested args (e.g. `where: { chain: "mainnet" }`) are handled correctly. Strips pre-existing `limit:` / `offset:` args first.

#### `fetchAllPages(endpoint, query, variables, queryDef, settings, signal)`

Main entrypoint. Returns:
```js
{
  rows,           // array of row objects, or null on fatal error
  page_count,
  duration_ms,
  warnings,       // array of strings
  error_type,     // null | 'network' | 'timeout' | 'cancelled' | 'graphql' |
                  //        'graphql_partial' | 'path_error' | 'size_limit' |
                  //        'row_limit' | 'page_limit' | 'invalid_query'
  error_message,
  graphql_errors, // array or null
}
```

**Pagination flow:**

- **`none`**: single fetch, no `first`/`skip` injection
- **`offset`**: calls `injectPaginationArgs(query, pageSize, skip)` per page; stops when `rows.length < pageSize`
- **`cursor`**: injects `{ first: pageSize, after: cursor }` as variables; reads `hasNextPage` via `has_next_path` and next cursor via `cursor_path`

**Error semantics:**
- `graphql` — errors array only, no data → not saved
- `graphql_partial` — errors + data together → rows saved, error recorded
- `network` / `timeout` / `cancelled` — not saved
- `size_limit` / `row_limit` / `page_limit` — not saved

**Per-page timeout:** creates an `AbortController` per page fetch with `setTimeout(timeoutPerPage)`. Combined with user-provided signal via event listener.

### `export.js`

- **`toJson(rows)`** — `JSON.stringify(rows, null, 2)`
- **`toCsv(rows, fieldMeta, keyField)`** — uses `csv-stringify`. Column order: key field first, then insertion order. Applies decimal scaling (same BigInt logic as frontend `applyDivisor`). Prefixes values starting with `=`, `+`, `-`, `@` with `'` (formula injection protection).
- **`toZip(entries)`** — uses `archiver` to stream a zip file. Each entry is `{ name, content }`.

### `middleware/validateEndpoint.js`

Used as route-level middleware on `POST /api/runs` and `POST /api/proxy`.

Validation steps:
1. Parse URL — reject on invalid syntax
2. Reject credentials in URL (`url.username` / `url.password`)
3. Reject blocked ports: 22, 25, 465, 587
4. `http:` allowed only for loopback hostnames (`localhost`, `127.0.0.1`, `::1`)
5. `https:`: resolve hostname with `dns.lookup({ all: true })`, check every A/AAAA record against ipaddr.js private range classification
6. Reject private, loopback, link-local, and ULA IPv6 addresses for `https:`
7. Set `req.validatedEndpoint = url.href` on success

---

## 8. Backend — All Routes

Every route module is a factory function: `module.exports = (db) => router`. Routes receive the db singleton.

### `GET /api/settings`
Returns all rows from `settings` as `{ data: { key: value, ... } }`.

### `PUT /api/settings`
Accepts a partial object. Whitelisted keys: `endpoint`, `warn_bytes`, `max_bytes`, `page_size`, `max_page_count`, `max_row_count`, `timeout_per_page_ms`, `builtin_imported`. Unknown keys silently ignored. Uses `INSERT OR REPLACE`. Returns `{ ok: true, data: { ...all settings } }`.

### `GET /api/settings/ping`
Reads `endpoint` from settings. POSTs `{ query: '{ __typename }' }` to it (5s timeout). Returns `{ ok: true, latency_ms: N }` or `{ ok: false, error: '...' }`.

---

### `GET /api/queries`
Returns all queries. JSON fields (`variable_defs`, `field_meta`, `chart_views`) are parsed before returning. Returns `{ data: [...] }`.

### `GET /api/queries/:id`
Single query with parsed JSON fields. Returns `{ data: query }` or `{ error: 'not_found' }` (404).

### `POST /api/queries`
Validates required fields. Inserts. Returns `{ data: newQuery }` (201). JSON fields stored as strings, returned parsed.

### `PUT /api/queries/:id`
Merges body over existing record. Re-validates. Returns `{ data: updatedQuery }`.

### `DELETE /api/queries/:id`
Cascades to `runs`. Returns 204. 404 if not found.

### `POST /api/queries/import`
Body: array of query objects. For each:
- If `is_builtin: true` → skip if a query with the same name already exists (preserves user edits)
- Otherwise → upsert by name (INSERT OR REPLACE)

Returns `{ data: { imported: N } }`.

---

### `POST /api/runs`

Body:
```json
{
  "query_id": 1,
  "start_date": "2026-01-01T00:00:00.000Z",   // optional
  "end_date":   "2026-03-31T23:59:59.999Z"    // optional
}
```

Flow:
1. Load query from DB → 400 `invalid_query` if not found
2. Load all settings (endpoint, limits)
3. Resolve variables from `variable_defs`:
   - `global_start` / `global_end` → format `start_date`/`end_date` per `date_format` (`unix_seconds`, `unix_ms`, `iso8601`)
   - `user` / `none` → use `default` field value
   - Pagination sources skipped (managed by ponder.js)
4. Build `variables_base` (user-visible vars, no pagination vars)
5. Auto-inject timestamp filter if no date variables and `start_date`/`end_date` provided:
   - Adds `WHERE timestamp >= $start AND timestamp <= $end` equivalent via `autoInjectDateFilter.js`
   - If injection fails, retries without injection and adds a warning
6. Call `fetchAllPages(endpoint, gql, vars, queryDef, settings, signal)`
7. Save run if `error_type` is null or `graphql_partial`
8. Update `queries.last_run_at` and `queries.last_row_count` on success
9. Return run record (always, even on error, with `id: null` if not saved)

**Response shape:**
```json
{
  "id": 42,
  "query_id": 1,
  "endpoint": "https://...",
  "start_date": "...",
  "end_date": "...",
  "variables_base": { "filter": "active" },
  "rows": [ { "id": "1", ... }, ... ],
  "row_count": 100,
  "page_count": 1,
  "duration_ms": 340,
  "error_type": null,
  "error_message": null,
  "graphql_errors": null,
  "warnings": [],
  "notes": null,
  "ran_at": "2026-05-20T19:00:00.000Z"
}
```

### `GET /api/runs?query_id=N&limit=20&offset=0`
Lists runs for a query, newest first. Excludes `rows` column. Returns `{ data: [...] }`.

### `GET /api/runs/:id`
Single run including full `rows` array (parsed from JSON string). Returns `{ data: run }`.

### `PATCH /api/runs/:id`
Body: `{ notes: string | null }`. Validates `notes` is a string or null (not a number, etc. → 400 `validation_error`). Updates DB. Returns `{ ok: true }` or 404 `not_found`.

### `DELETE /api/runs/:id`
Returns 204. 404 if not found.

---

### `GET /api/reports`
Returns all reports. Returns `{ data: [...] }`.

### `POST /api/reports`
Body: `{ name, description? }`. Returns `{ data: newReport }` (201).

### `GET /api/reports/:id`
Returns report with full query list (`query_ids` array and parsed query objects). Returns `{ data: report }`.

### `PUT /api/reports/:id`
Updates `name`, `description`, and `query_ids` (deletes/reinserts `report_queries`). Returns `{ data: updatedReport }`.

### `DELETE /api/reports/:id`
Returns 204.

### `POST /api/reports/:id/run`
Body: `{ start_date?, end_date? }`.
1. Creates `report_runs` record
2. Inserts pending status rows in `report_run_queries` for each query
3. Executes each query via `fetchAllPages`, saves run
4. Updates `report_run_queries` status to `ok` or `failed`
5. Returns `{ data: { report_run_id, statuses: [{ query_id, run_id, status, error_message }] } }`

### `GET /api/reports/runs/:id`
Returns report run with per-query status. Returns `{ data: reportRun }`.

---

### `GET /api/address-labels`
Returns all labels. Returns `{ data: [...] }`.

### `GET /api/address-labels/:id`
Single label. 404 if not found.

### `POST /api/address-labels`
Body: `{ address, name, chain?, notes? }`. `address` and `name` required. UNIQUE constraint on `(address, chain)`. Returns `{ data: newLabel }` (201).

### `PUT /api/address-labels/:id`
Updates all fields. Returns `{ data: updatedLabel }`.

### `DELETE /api/address-labels/:id`
Returns 204.

---

### `GET /api/endpoints`
Returns all saved profiles. `headers` field is JSON-parsed before returning.

### `GET /api/endpoints/:id`
Single profile.

### `POST /api/endpoints`
Body: `{ name, url?, headers? }`. `name` required. Returns `{ data: newEndpoint }` (201).

### `PUT /api/endpoints/:id`
Updates profile. If `is_default: true` is in the body, clears `is_default` on all other rows first, then sets it on this one. Returns `{ data: updatedEndpoint }`.

### `DELETE /api/endpoints/:id`
Returns 204.

---

### `POST /api/transfer/export`

Body:
```json
{
  "queryIds": [1, 2, 3],          // null = all queries
  "includeAddressLabels": true,
  "includeSettings": true
}
```

Returns a bundle object (not a file — frontend triggers download via Blob):
```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-20T12:00:00.000Z",
  "appVersion": "1.0.0",           // from backend/package.json version
  "queries": [ ...full query objects with parsed JSON fields... ],
  "addressLabels": [ { "address", "chain", "name", "notes" } ],
  "settings": { "endpoint": "...", "warn_bytes": "..." }
}
```

Settings exported: `endpoint`, `page_size`, `max_page_count`, `max_row_count`, `timeout_per_page_ms`, `warn_bytes`, `max_bytes`.

### `POST /api/transfer/preview`

Body: the raw bundle JSON.

Returns:
```json
{
  "queries": [
    { "name": "...", "status": "new"|"conflict", "existingId": 1|null, "isBuiltin": false }
  ],
  "addressLabels": [
    { "address": "0x...", "chain": "mainnet", "name": "...", "status": "new"|"conflict", "existingName": "..."|null }
  ],
  "settings": {
    "incoming": { "endpoint": "..." },
    "current":  { "endpoint": "..." }
  }
}
```

No writes.

### `POST /api/transfer/import`

Body:
```json
{
  "bundle": { ...full bundle... },
  "decisions": {
    "queries": [
      {
        "name": "...",
        "action": "overwrite"|"create_new"|"skip",
        "fields": ["gql", "variable_defs", "field_meta", "chart_views", "description", "category", "execution"]
      }
    ],
    "addressLabels": [
      { "address": "0x...", "chain": "mainnet", "action": "overwrite"|"skip" }
    ],
    "settings": ["endpoint", "warn_bytes"]
  }
}
```

Field group mappings for query overwrite:
- `"gql"` → updates `gql` column
- `"variable_defs"` → updates `variable_defs` column
- `"field_meta"` → updates `field_meta` column
- `"chart_views"` → updates `chart_views` column
- `"description"` → updates `description` column
- `"category"` → updates `category` column
- `"execution"` → updates `result_path`, `pagination_style`, `cursor_path`, `has_next_path`, `date_format`, `chain_mode`, `chain_var_name`, `chain_field`, `key_field`

`create_new`: inserts with name suffixed `" (imported)"`, increments to `" (imported 2)"` etc. until no conflict.

All operations in a single `db.transaction()`.

Returns: `{ queries: [{name, action, id}], addressLabels: [{address, chain, action}], settings: [key] }`

---

### `POST /api/introspect`

Body: `{ endpoint? }` (uses settings endpoint if not provided).

Posts the standard GraphQL introspection query. Returns simplified type map:
```json
{
  "data": {
    "Query": ["deposits", "users", ...],
    "Deposit": ["id", "amount", "timestamp", ...]
  }
}
```

### `POST /api/proxy`

Applies `validateEndpoint` middleware. Proxies the raw GraphQL POST body to the validated endpoint. Used by the SchemaExplorer (GraphiQL) component which cannot directly fetch due to CORS.

---

## 9. Frontend — App.jsx State & Data Flow

`App` is the single root component. All state lives here. Inner components receive only what they need via props.

### Module-level helper

```js
function divisorsFromFieldMeta(fm) {
  // converts field_meta.decimals to colDivisors format
  // { assets: { decimals: 18 } } → { assets: '1e18' }
  // { usdc:   { decimals:  6 } } → { usdc:  '1e6'  }
}
```

### State

| State | Type | Purpose |
|---|---|---|
| `startDate` | `Date \| null` | Global date range start |
| `endDate` | `Date \| null` | Global date range end |
| `selectedQuery` | `object \| null` | Currently loaded query definition (full object with parsed JSON fields) |
| `tab` | `string` | Active tab: `'editor'` \| `'results'` \| `'compare'` \| `'reports'` |
| `colDivisors` | `object` | `{ [colName]: 'raw' \| '1e6' \| '1e18' \| 'datetime' }` — lifted from ResultsView |
| `running` | `bool` | True while query is executing |
| `currentRun` | `object \| null` | Latest run result (rows + metadata) |
| `runError` | `object \| null` | Error from failed run |
| `historyOpen` | `bool` | Toggle run history drawer |
| `compareRuns` | `{ runA, runB } \| null` | Pinned runs for CompareView |
| `activeFilters` | `{ [field]: string[] }` | Active filter chip values |
| `sidebarRefresh` | `number` | Increment to trigger QuerySidebar refetch |
| `schemaExplorerOpen` | `bool` | Schema Explorer modal |
| `addressBookOpen` | `bool` | Address Book modal |
| `importExportOpen` | `bool` | Import/Export modal |
| `queryPreviewOpen` | `bool` | Query Preview modal |
| `endpointProfilesOpen` | `bool` | Endpoint Profiles modal |
| `endpointVersion` | `number` | Incremented to force EndpointBar remount (re-reads endpoint from server) |
| `addressLabels` | `array` | All address labels, loaded on mount, passed to ResultsTable/ResultFilters |
| `prefillGql` | `string \| null` | GQL pre-populated from Schema Explorer "Use This Query" |

### Key callbacks

**`handleSelectQuery(query)`** — sets `selectedQuery`, resets `currentRun`/`runError`/`activeFilters`, initialises `colDivisors` from `field_meta` via `divisorsFromFieldMeta`, switches tab to `'editor'`.

**`handleNewQuery()`** — clears `selectedQuery`, `currentRun`, `runError`, `prefillGql`, `colDivisors`.

**`handleUseQuery(gql)`** — closes schema explorer, sets `prefillGql`, clears selected query.

**`handleSaveQuery(saved)`** — updates `selectedQuery` with server response, increments `sidebarRefresh`.

**`handleDeleteQuery()`** — clears `selectedQuery`/`currentRun`, increments `sidebarRefresh`.

**`handleCloneQuery(query)`** — calls `createQuery({ ...query, name: query.name + ' (copy)' })`, increments `sidebarRefresh`.

**`handleSelectEndpointProfile(profile)`** — calls `updateSettings({ endpoint: profile.url })`, increments `endpointVersion` to force EndpointBar remount.

**`handleSaveChartView(view)`** — merges view into `selectedQuery.chart_views` (upsert by name), calls `updateQuery`, updates `selectedQuery` state.

**`handleDivisorChange(newDivisors)`** — updates `colDivisors` state AND persists to `field_meta.decimals` via `updateQuery`. Mapping: `'1e6'` → `decimals: 6`, `'1e18'` → `decimals: 18`, `'raw'` → delete `decimals`. This is how divisors survive re-runs.

**`handleRun(queryDef)`** — creates `AbortController` (stored in `abortRef`), calls `createRun({ query_id, start_date, end_date }, signal)`, switches to `'results'` tab immediately.

**`handleCancel()`** — calls `abortRef.current.abort()`.

**`handleLoadRun(run)`** — sets `currentRun`, switches to `'results'` tab, closes history drawer.

**`handleCompare(runA, runB)`** — sets `compareRuns`, switches to `'compare'` tab.

### Computed values

**`filteredRows`** (useMemo) — filters `currentRun.rows` by:
1. `startDate` / `endDate` against `row.timestamp` (unix seconds assumed)
2. `activeFilters` — AND of all active field chip values

**`needsRerun`** (useMemo) — true if user has widened date pickers beyond what `currentRun` fetched. Only widening triggers it (narrowing is handled client-side by `filteredRows`).

**`fieldMeta`** — `selectedQuery?.field_meta ?? {}` (already a parsed object)

### Modals and overlays

All modals are rendered at the App level and conditionally included:
- `EndpointProfilesModal` — `onSelect` calls `handleSelectEndpointProfile`; `onClose` closes modal
- `AddressBook` — `onLabelsChange` updates `addressLabels` state
- `ImportExportModal` — `onClose` closes modal AND increments `sidebarRefresh` (import may add queries)
- `SchemaExplorer` — `onUseQuery` calls `handleUseQuery`
- `QueryPreviewModal` — receives `currentRun` to display request details
- `HistoryDrawer` — always rendered (controls open/close via `open` prop)

### `ResultsView` (inner component)

```jsx
function ResultsView({ rows, fieldMeta, keyField, addressLabels, chartViews, onSaveView, colDivisors, onDivisorChange })
```

Manages a local `view` state (`'table'` | `'chart'`). Renders either `<ResultsTable>` or `<ResultsChart>`.

---

## 10. Frontend — Component Contracts

### `EndpointBar`

```jsx
<EndpointBar
  key={endpointVersion}    // force remount on profile switch
  onExplore={fn}           // called when user clicks "Explore Schema"
/>
```

Internal state: `url`, `status` (`'idle'|'ok'|'error'`), `latency`. Loads endpoint from `GET /api/settings` on mount. Saves on blur/Enter via `PUT /api/settings`. Pings via `GET /api/settings/ping`. Shows coloured dot + latency. Shows "Explore Schema" button only when status is `'ok'`.

---

### `DateRangePicker`

```jsx
<DateRangePicker
  startDate={Date|null}
  endDate={Date|null}
  onStartChange={fn}
  onEndChange={fn}
/>
```

Renders two `react-datepicker` inputs. No internal state.

---

### `QuerySidebar`

```jsx
<QuerySidebar
  selectedQueryId={number|null}
  onSelectQuery={fn}         // called with full query object
  onNewQuery={fn}
  onCloneQuery={fn}          // called with full query object; default no-op
  refreshTrigger={number}    // increment to force refetch
/>
```

Internal state: `queries`, `loading`, `search`, `hoveredId`.

On mount: calls `getSettings()` to check `builtin_imported`. If `!== '1'`, fetches builtin JSON files from `/queries/builtin/*.json` and calls `importQueries(builtins)`, then `updateSettings({ builtin_imported: '1' })`. Then calls `listQueries()`.

Queries are grouped by `category` before rendering. Filtered by `search` (case-insensitive name match) before grouping.

Clone button: always in DOM, `visibility: hidden` when `hoveredId !== q.id`, `visibility: visible` on hover. This preserves layout (no shifts when button appears).

---

### `QueryEditor`

```jsx
<QueryEditor
  query={object|null}        // null = new query mode
  prefillGql={string|null}   // pre-fill GQL field
  onSave={fn}                // called with saved query object
  onDelete={fn}
  onRun={fn}                 // called with queryDef
  running={bool}
/>
```

Manages full query form state: name, category, description, gql, variable_defs, field_meta, result_path, pagination_style, cursor_path, has_next_path, date_format, chain_mode, chain_var_name, chain_field, key_field.

Four inner tabs: **Query** (GQL editor), **Variables** (VariablePanel), **Execution** (pagination settings), **Field Meta**.

Buttons: **Save**, **Delete** (if existing), **Run**, **Introspect** (opens schema explorer via prop... actually calls `onRun` after saving), **Preview**.

---

### `VariablePanel`

```jsx
<VariablePanel
  variables={array}          // array of { name, source, default, type }
  onChange={fn}              // called with new array
/>
```

Renders an editable table of variable definitions. Sources: `global_start`, `global_end`, `user`, `none`, pagination sources.

---

### `ResultsTable`

```jsx
<ResultsTable
  rows={array}               // displayed rows (already filtered)
  fieldMeta={object}         // { [col]: { label?, decimals?, type?, unit? } }
  keyField={string}          // default 'id'
  colDivisors={object}       // { [col]: 'raw'|'1e6'|'1e18'|'datetime' }
  onDivisorChange={fn}       // called with new colDivisors object
  addressLabels={array}      // for label resolution
/>
```

Internal state: `sortCol`, `sortDir`, `copiedAddr`, `searchText`, `hiddenCols`, `colPanelOpen`, `statsCol`, `copyMenuOpen`, `copyLabel`.

**Virtualisation:** renders as a flat DOM table for ≤500 rows; switches to `useVirtualizer` for >500.

**Column order:** key field first, then insertion order (from first row's keys union).

**Divisor cycle:** `DIVISOR_CYCLE = ['raw', '1e6', '1e18']`. Clicking a column's badge cycles forward. `onDivisorChange` is called with the full updated divisors object — `App` persists to `field_meta.decimals`.

**Stats bar:** `statCandidateCols` = visible numeric columns (excludes unix_seconds/unix_ms typed, excludes `timestamp` column name). `statsResult` uses `applyDivisor()` when a divisor is active (BigInt-safe). Picker is a `<select>`; no column selected → no stats shown.

**`applyDivisor(value, divisor)`:** BigInt arithmetic. Preserves full precision. Returns a decimal string (e.g. `"1.234567890123456789"`).

**Address resolution:** `buildAddressMap(addressLabels)` builds a `Map<address, Map<chain, name>>`. `resolveAddress(value, chain, map)` checks `ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/`, then looks up chain-specific then chain-agnostic label.

**Copy formats:** Markdown table, HTML table, TSV — all use `visibleColumns` and `displayRows` (post-search).

---

### `ResultsChart`

```jsx
<ResultsChart
  rows={array}
  fieldMeta={object}
  keyField={string}
  colDivisors={object}
  onDivisorChange={fn}
  chartViews={array}         // saved named views
  onSaveView={fn}            // async fn(view) → bool
/>
```

Manages chart config: `xField`, `leftCols`, `rightCols`, `chartType`, `groupBy`, `leftCumulative`, `rightCumulative`, `showLegend`. Renders ECharts instance via `echarts.init`. Supports PNG download via `chart.getDataURL()`.

---

### `ResultFilters`

```jsx
<ResultFilters
  rows={array}               // unfiltered rows (currentRun.rows)
  activeFilters={object}     // { [field]: string[] }
  onChange={fn}              // called with new activeFilters
  addressLabels={array}
/>
```

Computes distinct values per column. Resolves address labels for display. Renders chip-style toggles.

---

### `HistoryDrawer`

```jsx
<HistoryDrawer
  queryId={number|null}
  open={bool}
  onClose={fn}
  onLoadRun={fn}             // called with full run object (rows included)
  onCompare={fn}             // called with (runA, runB)
/>
```

Internal state: `runs`, `loading`, `pinnedRun`, `editingNoteId`, `noteText`, `savingNote`.

Fetches runs via `listRuns(queryId)` when `open` becomes true. Pin/Compare flow: first click sets `pinnedRun`; second click on any other run calls `onCompare(pinnedRun, thisRun)`.

Note editing: click note area → textarea appears with existing note text. "Save" calls `patchRun(id, { notes })`. "Cancel" discards. Note displayed with `white-space: pre-wrap`.

---

### `CompareView`

```jsx
<CompareView
  runA={object}              // run with rows
  runB={object}              // run with rows
  keyField={string}
  fieldMeta={object}
/>
```

Matches rows by `keyField`. For each numeric column, shows `valueA`, `valueB`, `Δ (abs)`, `Δ (%)`. Rows only in A or only in B are highlighted yellow.

---

### `ReportBuilder`

```jsx
<ReportBuilder
  report={object|null}       // null = create mode
  onSave={fn}
  onClose={fn}
/>
```

Manages name, description, query list with drag-to-reorder. Calls `createReport` or `updateReport`.

---

### `ReportsPanel`

```jsx
<ReportsPanel
  startDate={Date|null}
  endDate={Date|null}
/>
```

Internal state: `reports`, `selectedReport`, `reportRun`, `pinnedReportRunId`, `compareReportRunIds`.

Lists reports on the left, shows report details and run history on the right. "Run" button calls `runReport(id, { start_date, end_date })`. "Compare" on two report runs opens `<ReportCompareView>` as an overlay.

---

### `ReportCompareView`

```jsx
<ReportCompareView
  runAId={number}
  runBId={number}
  onClose={fn}
/>
```

Fetches both report runs via `getReportRun`. Side-by-side per-query status comparison.

---

### `SchemaExplorer`

```jsx
<SchemaExplorer
  onClose={fn}
  onUseQuery={fn}            // called with GQL string
/>
```

Embeds GraphiQL pointed at `/api/proxy`. "Use This Query" button enabled once a query is typed. Calls `onUseQuery(gql)`.

---

### `AddressBook`

```jsx
<AddressBook
  onClose={fn}
  onLabelsChange={fn}        // called with full updated labels array
/>
```

Full-screen modal. Fetches labels on open. Inline add/edit/delete rows. Export (JSON download) and import (file pick) of the label list.

---

### `ImportExportModal`

```jsx
<ImportExportModal
  onClose={fn}               // App increments sidebarRefresh on close
/>
```

Two tabs: **Export** and **Import**.

Export tab state: `queryList`, `selectedQueryIds` (Set), `includeAddressLabels`, `includeSettings`, `exporting`. Calls `exportBundle`, receives JSON response, triggers download as `quarterly-export-YYYY-MM-DD.json` via `URL.createObjectURL(new Blob([...]))`.

Import tab — 3 steps:
1. File pick / drag-drop → parse JSON → validate `schemaVersion` → call `previewImport` → transition to step 2
2. Preview with per-item decisions (dropdowns + field checkboxes) → "Import N items" → call `commitImport` → step 3
3. Summary of results + Close button

---

### `QueryPreviewModal`

```jsx
<QueryPreviewModal
  run={object}               // currentRun (has variables_base, gql etc.)
  onClose={fn}
/>
```

Shows: endpoint URL, GQL query string, variables JSON. Code snippet tabs: Python, curl, TypeScript, R. Copy button per tab. Backdrop click closes.

---

### `EndpointProfilesModal`

```jsx
<EndpointProfilesModal
  onClose={fn}
  onSelect={fn}              // called with profile object; App updates settings
/>
```

Lists saved profiles. "+ New Profile" form: name, URL. "Use →" calls `onSelect(profile)` and closes. "Delete" calls `deleteEndpoint` after `window.confirm`.

---

### `ExportButtons`

```jsx
<ExportButtons
  runId={number}
/>
```

Renders JSON and CSV download anchor tags pointing at `/api/export/run/:id/json` and `/api/export/run/:id/csv`.

---

### `ChainFilter`

```jsx
<ChainFilter
  rows={array}
  value={string}             // selected chain
  onChange={fn}
/>
```

Dropdown of distinct chain values in `rows`. Also used internally by other components.

---

## 11. Frontend API Client

File: `frontend/src/api/client.js`

Single `request(method, path, body, signal)` function. Base path is `/api`. Always parses JSON (catches parse errors → null). Returns `{ status, ok, data }`.

All exports:

```js
// Settings
getSettings()
updateSettings(updates)
pingEndpoint()

// Queries
listQueries()
getQuery(id)
createQuery(body)
updateQuery(id, body)
deleteQuery(id)
importQueries(queries)

// Runs
createRun(body, signal)
listRuns(queryId, limit=20, offset=0)
getRun(id)
deleteRun(id)
patchRun(id, body)

// Reports
listReports()
getReport(id)
createReport(body)
updateReport(id, body)
deleteReport(id)
runReport(id, body)
getReportRun(reportRunId)
listReportRuns(reportId)

// Address labels
listAddressLabels()
createAddressLabel(body)
updateAddressLabel(id, body)
deleteAddressLabel(id)

// Introspect
introspect(endpoint?)

// Transfer
exportBundle(body)
previewImport(bundle)
commitImport(body)

// Export URLs (strings, not fetch calls)
exportRunJson(id)    // → '/api/export/run/:id/json'
exportRunCsv(id)     // → '/api/export/run/:id/csv'
exportReportRunZip(id)

// Endpoint profiles
listEndpoints()
createEndpoint(body)
updateEndpoint(id, body)
deleteEndpoint(id)
```

---

## 12. Key Implementation Details

### Divisor persistence

`colDivisors` is lifted to `App` level so it survives query re-runs. When a user cycles a divisor via the column badge in `ResultsTable`, `onDivisorChange(newDivisors)` is called. In `App.handleDivisorChange`:
1. Sets `colDivisors` state immediately
2. Maps divisors back to `field_meta.decimals` values
3. Calls `updateQuery(id, { ...selectedQuery, field_meta: currentMeta })`
4. Updates `selectedQuery` state with server response

On `handleSelectQuery`, `colDivisors` is initialised from `field_meta` via `divisorsFromFieldMeta`.

### Built-in query import

`QuerySidebar` handles this on mount. It checks `settings.builtin_imported`. If `!== '1'`:
1. Fetches JSON files from `/queries/builtin/*.json` (served by Vite/Express as static)
2. Calls `importQueries(builtins)` — the backend skips any that already exist by name
3. Calls `updateSettings({ builtin_imported: '1' })`

### Sidebar clone button (visibility vs conditional render)

Clone button is always in the DOM. Uses `visibility: hidden` (not `display: none`) so the button always occupies space, preventing layout shifts when hovering. This required an inner flex row wrapping just the name + button:

```jsx
<div className="sidebar-item" ...>   {/* flex-direction: column from CSS */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span className="sidebar-item-name">...</span>
    <button style={{ visibility: hoveredId === q.id ? 'visible' : 'hidden' }}>⧉</button>
  </div>
  <div className="sidebar-item-meta">...</div>
</div>
```

The `.sidebar-item` CSS class has `flex-direction: column`. Adding `display: flex; align-items: center` directly on it would override that to row, breaking layout.

### `needsRerun` logic

Only fires when the current date pickers extend *beyond* what was fetched:
- `runStart !== null && (startDate === null || startDate < runStart)` → user wants earlier data
- `runEnd !== null && (endDate === null || endDate > runEnd)` → user wants later data

Narrowing is safe (handled by `filteredRows` client-side).

### EndpointBar remount pattern

When a user selects an endpoint profile, the new URL is persisted via `updateSettings`. `EndpointBar` reads the URL from the server on mount. To force it to re-read (and re-ping), `App` increments `endpointVersion` which is passed as `key={endpointVersion}` to `EndpointBar`, causing React to unmount and remount it.

### `graphql_partial` semantics

When a Ponder page returns both `data` and `errors` (partial success), ponder.js:
1. Includes the rows from that page
2. Stops pagination immediately
3. Returns `error_type: 'graphql_partial'` with the rows

The run is saved to the database. The results tab shows a warning banner. The user can still view and export the partial results.

### Auto-inject date filter

`backend/src/utils/autoInjectDateFilter.js` modifies the GraphQL query string to add timestamp filters when:
- No `global_start`/`global_end` variable definitions exist in the query
- `start_date` and/or `end_date` were provided in the request body

This is attempted first; if string manipulation fails (unusual query structure), the run retries without injection and adds a warning to the result.

### `variables_base` in saved runs

`variables_base` stores only user-visible variables (date vars + user-input vars). Pagination variables (`pagination_first`, `pagination_skip`, `pagination_after`) are excluded. This is what the Query Preview modal shows.

---

## 13. Testing

### Backend (Jest)

Run: `npm test --workspace=backend`

Config: `jest` in `backend/package.json`, `--runInBand` (sequential — avoids SQLite contention).

**Pattern for DB integration tests:**
- Guard with `nativeAvailable` check: tests try to `new Database(':memory:')` and skip all tests if it fails
- `makeDb()` creates an in-memory SQLite with full schema, inserts test settings
- `makeApp(db)` creates a fresh Express app with route under test
- Each test creates its own db + app, closes db at end
- `nock` mocks HTTP calls to the GraphQL endpoint

**`runs.test.js` adds `notes TEXT` to its `makeDb()` schema** because migration 004 adds it via `ALTER TABLE`, which the in-memory test db doesn't run.

### Frontend (Vitest)

Run: `npm test --workspace=frontend`

Config: `vitest.config.js` with `environment: 'jsdom'`, `setupFiles: ['@testing-library/jest-dom/vitest']`.

**Mocking pattern:**
- `vi.mock('../../api/client.js', () => ({ fn: vi.fn() }))` — mock BEFORE import
- `import Component from '../Component.jsx'` — import AFTER mock
- `@tanstack/react-virtual` is mocked to return all items (no DOM scroll measurement)

**`ResultsTable` mock for `addressLabels.js`:**
```js
vi.mock('../../utils/addressLabels.js', () => ({
  buildAddressMap: () => new Map(),
  resolveAddress: (_value, _chain, _map) => null,
}))
```

---

## 14. CSS / Theme Variables

The app uses CSS custom properties for theming. Variables expected:

```css
--color-bg           /* page background */
--color-surface      /* card / panel background */
--color-surface2     /* slightly elevated surface */
--color-border       /* borders, dividers */
--color-text         /* primary text */
--color-text-muted   /* secondary text */
--color-accent       /* brand colour (blue) */
--color-error        /* error red */
--color-warning      /* warning orange */
--font-mono          /* monospace font stack */
```

CSS class patterns used:
- `.app-layout`, `.app-topbar`, `.app-body`, `.app-sidebar`, `.app-main`
- `.tab-bar` — horizontal button row; `.active` modifier on the selected tab
- `.sidebar-item`, `.sidebar-item.active`, `.sidebar-item-name`, `.sidebar-item-meta`
- `.sidebar-category` — category group header
- `.sidebar-actions` — top row of the sidebar (new + refresh buttons)
- `.results-table-container`, `.results-table` — scrollable table wrapper
- `.error-banner`, `.warning-banner` — alert strips
- `.spinner` — CSS animation for loading state

---

## 15. Deployment Notes

**Dev:** `npm run dev` — Vite proxies `/api` to `http://127.0.0.1:8790`.

**Production (single-process):**
1. `npm run build --workspace=frontend` — outputs to `frontend/dist/`
2. Add to `backend/src/server.js`:
   ```js
   const path = require('path')
   app.use(express.static(path.join(__dirname, '../../frontend/dist')))
   app.get('*', (req, res) =>
     res.sendFile(path.join(__dirname, '../../frontend/dist/index.html')))
   ```
3. Run `node backend/src/server.js` — serves both API and SPA on port 8790.

**Environment variable:** `PORT` overrides the default 8790.

**`better-sqlite3` requires native compilation.** On systems without build tools, the backend will fail to start. Install: `apt-get install build-essential python3` (Linux) or Xcode Command Line Tools (macOS).

**The database file** is at `backend/data/quarterly.db`. Back this up to preserve query definitions, run history, and address labels.

**Not suitable for multi-user / internet-exposed deployment** without additional auth, rate limiting, and network hardening. The SSRF protections are present but the tool is designed for single-user localhost use.
