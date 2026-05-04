export type DestructiveMigrationFinding = {
  kind: "drop-table" | "drop-column" | "destructive-type-rewrite" | "non-null-add-without-default-on-populated-table" | "policy-removal"
  file: string
  line: number
  redactedSnippet: string
}

function stripComments(sql: string): string[] {
  let cleaned = ""
  let inString: "'" | "\"" | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false
        cleaned += char
      }
      continue
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        index += 1
        continue
      }
      if (char === "\n") cleaned += char
      continue
    }
    if (inString) {
      cleaned += char
      if (char === "\\" && next) {
        cleaned += next
        index += 1
        continue
      }
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
