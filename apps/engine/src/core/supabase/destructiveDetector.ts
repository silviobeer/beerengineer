export type DestructiveMigrationFinding = {
  kind: "drop-table" | "drop-column" | "destructive-type-rewrite" | "non-null-add-without-default-on-populated-table" | "policy-removal"
  file: string
  line: number
  redactedSnippet: string
}

function stripComments(sql: string): string[] {
  return sql.split(/\r?\n/).map(line => line.replace(/--.*$/, ""))
}

function redact(line: string): string {
  return line.replaceAll(/'(?:''|[^'])*'/g, "'[redacted]'").trim()
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
      const lower = line.toLowerCase()
      const push = (kind: DestructiveMigrationFinding["kind"]) => findings.push({ kind, file: migration.file, line: index + 1, redactedSnippet: redact(line) })
      if (/\bdrop\s+table\b/.test(lower)) push("drop-table")
      if (/\bdrop\s+column\b/.test(lower)) push("drop-column")
      if (/\balter\s+column\b.*\btype\b/.test(lower)) push("destructive-type-rewrite")
      if (/\bdrop\s+policy\b/.test(lower)) push("policy-removal")
      const notNull = /\balter\s+table\s+("?[\w.]+"?)\s+.*\balter\s+column\b.*\bset\s+not\s+null\b/.exec(lower)
      if (notNull && populated.has(notNull[1].replaceAll('"', "")) && !/\bdefault\b/.test(lower)) {
        push("non-null-add-without-default-on-populated-table")
      }
    })
  }
  return findings
}
