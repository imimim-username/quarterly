import React, { useState, useCallback } from 'react'

// ─── Code generators ──────────────────────────────────────────────────────────

/**
 * Try to extract the top-level field name from the GQL so snippets can
 * show a realistic result-path comment (e.g. data["alchemistDeposits"]).
 * Returns null when it can't be determined safely.
 */
function extractTopField(gql) {
  if (!gql) return null
  // After the opening brace of the query body, the first word is the field name.
  const m = gql.match(/\{\s*([a-zA-Z_]\w*)/)
  return m ? m[1] : null
}

/** Convert a JSON-serialisable object to a Python dict literal string. */
function toPythonLiteral(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/: null/g, ': None')
    .replace(/: true/g, ': True')
    .replace(/: false/g, ': False')
}

/** Indent every line of a string by `n` spaces. */
function indent(str, n) {
  const pad = ' '.repeat(n)
  return str.split('\n').map(l => pad + l).join('\n')
}

function genCurl(endpoint, gql, variables) {
  const body = JSON.stringify({ query: gql ?? '', variables: { ...variables, limit: 100, skip: 0 } }, null, 2)
  return `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${body.replace(/'/g, "'\\''")}'`
}

function genPython(endpoint, gql, variables, topField) {
  const varLiteral = toPythonLiteral(variables)
  const pathComment = topField
    ? `# Items are at: data["data"]["${topField}"]["items"]  (adjust to your schema)`
    : `# Inspect data["data"] to find the items array for your query`
  return `import requests

ENDPOINT = "${endpoint}"

QUERY = """
${gql ?? '# query not available for historical runs'}
"""

BASE_VARIABLES = ${varLiteral}

def fetch_all():
    results = []
    skip = 0
    limit = 100

    while True:
        variables = {**BASE_VARIABLES, "limit": limit, "skip": skip}
        response = requests.post(
            ENDPOINT,
            json={"query": QUERY, "variables": variables},
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        data = response.json()

        ${pathComment}
        items = []  # TODO: extract items from data["data"]
        if not items:
            break

        results.extend(items)
        skip += limit

    return results

if __name__ == "__main__":
    rows = fetch_all()
    print(f"Fetched {len(rows)} rows")
`
}

function genJavaScript(endpoint, gql, variables, topField) {
  const varsJson = JSON.stringify(variables, null, 2)
  const pathComment = topField
    ? `// Items are at data.data.${topField}.items — adjust to your schema`
    : `// Inspect data.data to find the items array`
  return `const ENDPOINT = "${endpoint}";

const QUERY = \`
${gql ?? '// query not available for historical runs'}
\`;

const BASE_VARIABLES = ${varsJson};

async function fetchAll() {
  const results = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { ...BASE_VARIABLES, limit, skip },
      }),
    });

    if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
    const data = await response.json();

    ${pathComment}
    const items = []; // TODO: extract items from data.data
    if (items.length === 0) break;

    results.push(...items);
    skip += limit;
  }

  return results;
}

fetchAll().then(rows => console.log(\`Fetched \${rows.length} rows\`));
`
}

function genTypeScript(endpoint, gql, variables, topField) {
  const varsJson = JSON.stringify(variables, null, 2)
  const pathComment = topField
    ? `// Items are at data.data.${topField}.items — adjust to your schema`
    : `// Inspect data.data to find the items array`
  return `interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: { message: string }[];
}

const ENDPOINT = "${endpoint}";

const QUERY = \`
${gql ?? '// query not available for historical runs'}
\`;

const BASE_VARIABLES: Record<string, unknown> = ${varsJson};

async function graphql<T>(
  variables: Record<string, unknown>
): Promise<GraphQLResponse<T>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return res.json();
}

async function fetchAll(): Promise<unknown[]> {
  const results: unknown[] = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const data = await graphql({ ...BASE_VARIABLES, limit, skip });

    if (data.errors?.length) {
      throw new Error(data.errors.map(e => e.message).join(", "));
    }

    ${pathComment}
    const items: unknown[] = []; // TODO: extract items from data.data
    if (items.length === 0) break;

    results.push(...items);
    skip += limit;
  }

  return results;
}

fetchAll().then(rows => console.log(\`Fetched \${rows.length} rows\`));
`
}

function genR(endpoint, gql, variables, topField) {
  // Build R list literal from variables object
  function toRValue(v) {
    if (v === null) return 'NULL'
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'string') return `"${v.replace(/"/g, '\\"')}"`
    return String(v)
  }
  const rVars = Object.entries(variables).length > 0
    ? 'list(\n' + Object.entries(variables).map(([k, v]) => `    ${k} = ${toRValue(v)}`).join(',\n') + '\n  )'
    : 'list()'

  const pathComment = topField
    ? `# Items are at result$data$${topField}$items — adjust to your schema`
    : `# Inspect result$data to find the items array`

  return `library(httr2)
library(jsonlite)

ENDPOINT <- "${endpoint}"

QUERY <- '
${gql ?? '# query not available for historical runs'}
'

base_variables <- ${rVars}

fetch_all <- function() {
  results <- list()
  skip <- 0
  limit <- 100L

  repeat {
    variables <- c(base_variables, list(limit = limit, skip = skip))

    resp <- request(ENDPOINT) |>
      req_method("POST") |>
      req_headers("Content-Type" = "application/json") |>
      req_body_raw(toJSON(
        list(query = QUERY, variables = variables),
        auto_unbox = TRUE
      )) |>
      req_perform()

    result <- resp |> resp_body_json()

    ${pathComment}
    items <- list()  # TODO: extract items from result$data

    if (length(items) == 0) break

    results <- c(results, items)
    skip <- skip + limit
  }

  results
}

rows <- fetch_all()
cat("Fetched", length(rows), "rows\\n")
`
}

// ─── Language tab config ──────────────────────────────────────────────────────

const LANGS = [
  { key: 'curl',       label: 'curl',       gen: genCurl       },
  { key: 'python',     label: 'Python',     gen: genPython     },
  { key: 'javascript', label: 'JavaScript', gen: genJavaScript },
  { key: 'typescript', label: 'TypeScript', gen: genTypeScript },
  { key: 'r',          label: 'R',          gen: genR          },
]

// ─── CodeExamples sub-component ───────────────────────────────────────────────

function CodeExamples({ endpoint, gql, variables }) {
  const [lang, setLang] = useState('python')
  const [copied, setCopied] = useState(false)

  const topField = extractTopField(gql)
  const current  = LANGS.find(l => l.key === lang)
  const code     = current ? current.gen(endpoint, gql, variables, topField) : ''

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <div>
      {/* Section label + lang tabs + copy on one row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
          Code examples
        </span>
        {LANGS.map(l => (
          <button
            key={l.key}
            onClick={() => setLang(l.key)}
            style={{
              fontSize: 11,
              padding: '1px 8px',
              background: lang === l.key ? 'var(--color-accent)' : 'transparent',
              color: lang === l.key ? '#fff' : 'var(--color-text-muted)',
              border: `1px solid ${lang === l.key ? 'var(--color-accent)' : 'var(--color-border)'}`,
              borderRadius: 3,
            }}
          >
            {l.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={copy} style={{ fontSize: 11, padding: '1px 6px' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <pre style={{
        margin: 0,
        padding: '10px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        fontSize: 11.5,
        lineHeight: 1.55,
        overflowX: 'auto',
        whiteSpace: 'pre',
        color: 'var(--color-text)',
        maxHeight: 340,
        overflowY: 'auto',
      }}>
        {code}
      </pre>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
        Snippets show one page (limit&nbsp;100, skip&nbsp;0) in a fetch-all loop.
        Adjust the result-path comment to match your query's response shape.
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

/**
 * Centered modal that shows the GraphQL query and variables actually sent to the
 * endpoint for a given run, plus copy-pasteable code snippets for common languages.
 *
 * Props:
 *   run      — the currentRun object from App state
 *   onClose  — called when the user dismisses the modal
 */
export default function QueryPreviewModal({ run, onClose }) {
  const [copied, setCopied] = useState(null) // 'query' | 'vars' | null

  const copy = useCallback((text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    }).catch(() => {})
  }, [])

  const gql       = run?.gql_used      ?? null   // present on fresh runs
  // variables_used includes auto-injected timestamp args; fall back to variables_base
  // for historical runs loaded from history (neither field will be present there either,
  // but variables_base is at least always populated from the DB).
  const variables = run?.variables_used ?? run?.variables_base ?? {}
  const endpoint  = run?.endpoint      ?? '—'
  const varsJson  = JSON.stringify(variables, null, 2)

  // Backdrop click closes the modal
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const preStyle = {
    margin: 0,
    padding: '10px 12px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 12,
    overflowX: 'auto',
    whiteSpace: 'pre',
    color: 'var(--color-text)',
  }

  const labelStyle = {
    fontSize: 11,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        width: '100%',
        maxWidth: 740,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Query sent to endpoint</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 12, padding: '2px 8px' }}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Endpoint */}
          <div>
            <div style={{ ...labelStyle, marginBottom: 4 }}>Endpoint</div>
            <code style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--color-text)' }}>{endpoint}</code>
          </div>

          {/* Query */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={labelStyle}>Query</span>
              {gql && (
                <button onClick={() => copy(gql, 'query')} style={{ fontSize: 11, padding: '1px 6px' }}>
                  {copied === 'query' ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </div>
            {gql ? (
              <pre style={preStyle}>{gql}</pre>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Query text not available for historical runs loaded from the history drawer.
              </div>
            )}
          </div>

          {/* Variables */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={labelStyle}>Variables</span>
              <button onClick={() => copy(varsJson, 'vars')} style={{ fontSize: 11, padding: '1px 6px' }}>
                {copied === 'vars' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre style={preStyle}>{varsJson}</pre>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Note: pagination args (limit / offset) are injected automatically per page and are not shown here.
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--color-border)' }} />

          {/* Code examples */}
          <CodeExamples endpoint={endpoint} gql={gql} variables={variables} />

        </div>
      </div>
    </div>
  )
}
