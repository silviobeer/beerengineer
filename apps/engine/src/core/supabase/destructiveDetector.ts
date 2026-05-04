export type DestructiveMigrationFinding = {
  kind: "drop-table" | "drop-column" | "destructive-type-rewrite" | "non-null-add-without-default-on-populated-table" | "policy-removal"
  file: string
  line: number
  redactedSnippet: string
}

function stripComments(sql: string): string[] {
  // Tokenizer that preserves whitespace and line structure so we can run
  // line-based regex detection on the cleaned text. Rules below mirror the
  // PostgreSQL lexer; deviations are flagged in comments next to the rule.
  let cleaned = ""
  let inString: "'" | "\"" | null = null
  let dollarQuote: string | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (dollarQuote) {
      // Dollar-quoted string contents are scannable: although Postgres treats
      // them as a single string literal, the body executes when the function
      // runs, so a DROP TABLE inside CREATE FUNCTION ... AS $$ ... $$ is a
      // real destructive action that must trigger a finding.
      // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-DOLLAR-QUOTING
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1
        dollarQuote = null
        continue
      }
      cleaned += char
      continue
    }
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false
        cleaned += char
      }
      continue
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        // Postgres treats block comments as whitespace at the lexer level, so
        // `DROP/**/TABLE x` lexes as `DROP TABLE x`. Emit a single space when
        // the comment ends so adjacent keywords cannot be spliced together.
        // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-COMMENTS
        inBlockComment = false
        index += 1
        cleaned += " "
        continue
      }
      if (char === "\n") cleaned += char
      continue
    }
    if (inString) {
      cleaned += char
      // Postgres default standard_conforming_strings=on (since 9.1) treats
      // backslash as an ordinary character inside ordinary single-quoted
      // strings. Only doubled '' (or doubled "") escapes the closing quote.
      // Backslash-escape handling is intentionally absent. E'…' strings do
      // honour backslash escapes, but emitting their characters is the safer
      // default — destructive keywords inside an E-string are still surfaced
      // for review rather than silently swallowed.
      // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS
      if (char === inString) {
        if (next === inString) {
          cleaned += next
          index += 1
        } else {
          inString = null
        }
      }
      continue
    }
    const marker = dollarQuoteMarkerAt(sql, index)
    if (marker) {
      dollarQuote = marker
      index += marker.length - 1
      continue
    }
    if (char === "-" && next === "-") {
      inLineComment = true
      index += 1
      continue
    }
    if (char === "/" && next === "*") {
      inBlockComment = true
      index += 1
      continue
    }
    if (char === "'" || char === "\"") {
      inString = char
    }
    cleaned += char
  }
  return cleaned.split(/\r?\n/)
}

function dollarQuoteMarkerAt(sql: string, index: number): string | null {
  // PostgreSQL dollar-quote tag: `$tag$` where tag is empty or an identifier.
  // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-DOLLAR-QUOTING
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))
  return match?.[0] ?? null
}

function redact(line: string): string {
  return line.replaceAll(/'(?:''|[^'])*'/g, "'[redacted]'").trim()
}

function normalizedTableName(identifier: string): string {
  return identifier.replaceAll("\"", "").split(".").pop() ?? identifier
}

export function detectDestructiveMigrations(input: {
  migrations: Array<{ file: string; sql: string }>
  populatedTables?: string[]
}): DestructiveMigrationFinding[] {
  const populated = new Set((input.populatedTables ?? []).map(table => table.toLowerCase()))
  const findings: DestructiveMigrationFinding[] = []
  for (const migration of input.migrations) {
    const lines = stripComments(migration.sql)
    lines.forEach((line, index) => {
      const redactedSnippet = redact(line)
      const lower = redactedSnippet.toLowerCase()
      const push = (kind: DestructiveMigrationFinding["kind"]) => findings.push({ kind, file: migration.file, line: index + 1, redactedSnippet })
      if (/\bdrop\s+table\b/.test(lower)) push("drop-table")
      if (/\bdrop\s+column\b/.test(lower)) push("drop-column")
      if (/\balter\s+column\b.*\btype\b/.test(lower)) push("destructive-type-rewrite")
      if (/\bdrop\s+policy\b/.test(lower)) push("policy-removal")
      const notNull = /\balter\s+table\s+((?:"?[\w]+"?\.)*"?[\w]+"?)\s+.*\balter\s+column\b.*\bset\s+not\s+null\b/.exec(lower)
      if (notNull && populated.has(normalizedTableName(notNull[1])) && !/\bdefault\b/.test(lower)) {
        push("non-null-add-without-default-on-populated-table")
      }
    })
  }
  return findings
}
