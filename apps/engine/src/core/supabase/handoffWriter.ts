import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { readActiveSecretValue, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { SupabaseDbMode } from "./types.js"

export type SupabaseHandoffClient = {
  getProjectKeys(projectRef: string, branchRef?: string): Promise<{ anonKey: string; serviceRoleKey?: string; url: string }>
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
  dbMode?: SupabaseDbMode
  branchRef?: string
  client: SupabaseHandoffClient
  secretStore?: SecretStoreOptions
}): Promise<{ path: string; env: { SUPABASE_HANDOFF_ENV: string } }> {
  if (process.platform === "win32") throw new Error("Supabase handoff requires a POSIX filesystem")
  if (!readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, input.secretStore)) {
    throw new Error("Supabase management token missing")
  }
  const path = supabaseHandoffPath(input.workspaceRoot, input.runId, input.waveId)
  const dbMode = input.dbMode ?? "branching"
  const keys = await input.client.getProjectKeys(
    input.projectRef,
    dbMode === "branching" ? input.branchRef : undefined,
  )
  const content = dbMode === "direct"
    ? [
        `SUPABASE_URL=${keys.url}`,
        `SUPABASE_ANON_KEY=${keys.anonKey}`,
        "",
        "# Direct mode: automatic production migration is skipped.",
        "# Manual migration review is required before database changes are applied.",
        "",
      ].join("\n")
    : await branchingHandoffContent(input.client, input.projectRef, input.branchRef, keys)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700)
  let handle
  try {
    handle = await open(path, "wx", 0o600)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Supabase handoff already exists: ${path}`)
    throw err
  }
  try {
    await handle.writeFile(content)
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
  return { path, env: { SUPABASE_HANDOFF_ENV: path } }
}

async function branchingHandoffContent(
  client: SupabaseHandoffClient,
  projectRef: string,
  branchRef: string | undefined,
  keys: { anonKey: string; serviceRoleKey?: string; url: string },
): Promise<string> {
  if (!branchRef) throw new Error("Supabase branch ref missing")
  const dbUrl = await client.getBranchConnectionString(projectRef, branchRef)
  return [
    `SUPABASE_URL=${keys.url}`,
    `SUPABASE_ANON_KEY=${keys.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${keys.serviceRoleKey ?? ""}`,
    `SUPABASE_DB_URL=${dbUrl}`,
    "",
  ].join("\n")
}

export async function ensureSupabaseHandoffGitignore(workspaceRoot: string): Promise<boolean> {
  const path = join(workspaceRoot, ".gitignore")
  const entry = ".beerengineer/handoff/supabase/"
  let current = ""
  try {
    current = await readFile(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  if (current.split(/\r?\n/).includes(entry)) return false
  await writeFile(path, `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${entry}\n`, { flag: "w" })
  return true
}
