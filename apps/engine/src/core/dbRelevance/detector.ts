import type { DbRelevanceDetection, DbRelevanceSignal } from "./types.js"

const EXCLUDED_PREFIXES = ["node_modules/", "dist/", ".next/", "build/"]
const SQL_DDL = /\b(create table|alter table|drop table|drop column|create policy|alter policy)\b/i
const SUPABASE_PATHS = [
  /^supabase\/migrations\/.+\.sql$/,
  /^supabase\/seed\.sql$/,
  /^supabase\/seeds\/.+/,
  /^supabase\/config\.toml$/,
]

export function detectDbRelevance(input: {
  changedFiles: string[]
  fileContents?: Record<string, string>
  previousFileContents?: Record<string, string>
  workspacePostgresClients?: string[]
}): DbRelevanceDetection {
  const signals: DbRelevanceSignal[] = []
  for (const path of input.changedFiles) {
    if (EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix))) continue
    const content = input.fileContents?.[path] ?? ""
    const previous = input.previousFileContents?.[path] ?? ""
    if (SUPABASE_PATHS.some(pattern => pattern.test(path))) {
      signals.push({ kind: "path", path, reason: "Supabase schema/seed/config path changed" })
    }
    if (content.includes("@supabase/supabase-js") && !previous.includes("@supabase/supabase-js")) {
      signals.push({ kind: "import", path, reason: "New @supabase/supabase-js import" })
    }
    for (const client of input.workspacePostgresClients ?? []) {
      const inCurrent = content.includes(`"${client}"`) || content.includes(`'${client}'`)
      const inPrevious = previous.includes(`"${client}"`) || previous.includes(`'${client}'`)
      if (inCurrent && !inPrevious) {
        signals.push({ kind: "import", path, reason: `Postgres client import: ${client}` })
      }
    }
    const ddl = SQL_DDL.exec(content)
    if (ddl) signals.push({ kind: "sql", path, reason: `SQL DDL keyword: ${ddl[1].toLowerCase()}` })
  }
  return { signals }
}
