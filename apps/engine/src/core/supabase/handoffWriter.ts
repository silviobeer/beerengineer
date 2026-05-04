import { existsSync } from "node:fs"
import { chmod, mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { readActiveSecretValue, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"

export type SupabaseHandoffClient = {
  getProjectKeys(projectRef: string, branchRef: string): Promise<{ anonKey: string; serviceRoleKey: string; url: string }>
  getBranchConnectionString(projectRef: string, branchRef: string): Promise<string>
}

export function supabaseHandoffPath(workspaceRoot: string, runId: string, waveId: string): string {
  return join(workspaceRoot, ".beerengineer", "handoff", "supabase", runId, `${waveId}.env`)
}

export async function writeSupabaseHandoff(input: {
  workspaceRoot: string
  runId: string
  waveId: string
  projectRef: string
  branchRef: string
  client: SupabaseHandoffClient
  secretStore?: SecretStoreOptions
}): Promise<{ path: string; env: { SUPABASE_HANDOFF_ENV: string } }> {
  if (process.platform === "win32") throw new Error("Supabase handoff requires a POSIX filesystem")
  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, input.secretStore)
  if (!token) throw new Error("Supabase management token missing")
  const path = supabaseHandoffPath(input.workspaceRoot, input.runId, input.waveId)
  if (existsSync(path)) throw new Error(`Supabase handoff already exists: ${path}`)
  const keys = await input.client.getProjectKeys(input.projectRef, input.branchRef)
  const dbUrl = await input.client.getBranchConnectionString(input.projectRef, input.branchRef)
  const content = [
    `SUPABASE_URL=${keys.url}`,
    `SUPABASE_ANON_KEY=${keys.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${keys.serviceRoleKey}`,
    `SUPABASE_DB_URL=${dbUrl}`,
    "",
  ].join("\n")
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700)
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, path)
  await chmod(path, 0o600)
  return { path, env: { SUPABASE_HANDOFF_ENV: path } }
}

export async function ensureSupabaseHandoffGitignore(workspaceRoot: string): Promise<boolean> {
  const path = join(workspaceRoot, ".gitignore")
  const entry = ".beerengineer/handoff/supabase/"
  let current = ""
  try {
    current = await import("node:fs/promises").then(fs => fs.readFile(path, "utf8"))
  } catch {
    current = ""
  }
  if (current.split(/\r?\n/).includes(entry)) return false
  await writeFile(path, `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${entry}\n`, { flag: "w" })
  return true
}
