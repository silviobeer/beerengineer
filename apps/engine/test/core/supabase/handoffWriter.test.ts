import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureSupabaseHandoffGitignore, writeSupabaseHandoff, supabaseHandoffPath } from "../../../src/core/supabase/handoffWriter.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"

function readTouchedFiles(root: string): Array<{ path: string; content: string }> {
  const entries: Array<{ path: string; content: string }> = []
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      entries.push({ path, content: readFileSync(path, "utf8") })
    }
  }
  walk(root)
  return entries
}

function workspaceArtifacts(root: string): Array<{ path: string; content: string }> {
  return readTouchedFiles(root).filter(file => file.path === join(root, ".gitignore") || file.path.includes(`${join(root, ".beerengineer")}`))
}

test("PROJ-4 PRD-6 US-1: handoff writer writes required dotenv from live API values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-"))
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp", { storePath })
  try {
    const result = await writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run-1",
      waveId: "wave-1",
      projectRef: "proj",
      branchRef: "br",
      secretStore: { storePath },
      client: {
        getProjectKeys: async () => ({ url: "https://example.supabase.co", anonKey: "anon", serviceRoleKey: "service" }),
        getBranchConnectionString: async () => "postgres://branch",
      },
    })
    assert.equal(result.path, supabaseHandoffPath(dir, "run-1", "wave-1"))
    assert.deepEqual(result.env, { SUPABASE_HANDOFF_ENV: result.path })
    assert.match(readFileSync(result.path, "utf8"), /SUPABASE_DB_URL=postgres:\/\/branch/)
    await assert.rejects(() => writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run-1",
      waveId: "wave-1",
      projectRef: "proj",
      branchRef: "br",
      secretStore: { storePath },
      client: { getProjectKeys: async () => ({ url: "", anonKey: "", serviceRoleKey: "" }), getBranchConnectionString: async () => "" },
    }), /already exists/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-3 AC-3.1/AC-3.2/AC-3.4: direct-mode handoff keeps the standard location, omits branch data, and includes manual migration guidance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-direct-"))
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_direct_secret", { storePath })
  const staleBranchRef = "stale_branch_ref"
  const calls: Array<{ kind: string; branchRef?: string }> = []

  try {
    await ensureSupabaseHandoffGitignore(dir)
    const result = await writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run-direct",
      waveId: "wave-direct",
      projectRef: "proj_direct",
      dbMode: "direct",
      branchRef: staleBranchRef,
      secretStore: { storePath },
      client: {
        getProjectKeys: async (projectRef, branchRef) => {
          assert.equal(projectRef, "proj_direct")
          calls.push({ kind: "keys", branchRef })
          return { url: "https://proj_direct.supabase.co", anonKey: "anon_direct", serviceRoleKey: "service_direct" }
        },
        getBranchConnectionString: async () => {
          calls.push({ kind: "db" })
          throw new Error("direct mode must not request a branch connection string")
        },
      },
    })

    assert.equal(result.path, supabaseHandoffPath(dir, "run-direct", "wave-direct"))
    const content = readFileSync(result.path, "utf8")
    assert.match(content, /SUPABASE_URL=https:\/\/proj_direct\.supabase\.co/)
    assert.match(content, /SUPABASE_ANON_KEY=anon_direct/)
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY=/)
    assert.doesNotMatch(content, /SUPABASE_DB_URL=/)
    assert.doesNotMatch(content, new RegExp(staleBranchRef))
    assert.match(content, /automatic production migration is skipped/i)
    assert.match(content, /manual migration review is required before database changes are applied/i)
    assert.deepEqual(calls, [{ kind: "keys", branchRef: undefined }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-3 AC-3.3: handoff generation never writes the plaintext management token into workspace artifacts", async () => {
  const directDir = mkdtempSync(join(tmpdir(), "be2-handoff-direct-token-"))
  const branchingDir = mkdtempSync(join(tmpdir(), "be2-handoff-branch-token-"))
  const directStorePath = join(directDir, "secrets.json")
  const branchingStorePath = join(branchingDir, "secrets.json")
  const directToken = "sbp_direct_sentinel_secret"
  const branchingToken = "sbp_branching_sentinel_secret"
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, directToken, { storePath: directStorePath })
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, branchingToken, { storePath: branchingStorePath })

  try {
    await ensureSupabaseHandoffGitignore(directDir)
    await ensureSupabaseHandoffGitignore(branchingDir)

    await writeSupabaseHandoff({
      workspaceRoot: directDir,
      runId: "run-direct",
      waveId: "wave-direct",
      projectRef: "proj_direct",
      dbMode: "direct",
      branchRef: "stale_direct_branch",
      secretStore: { storePath: directStorePath },
      client: {
        getProjectKeys: async () => ({ url: "https://proj_direct.supabase.co", anonKey: "anon_direct", serviceRoleKey: "service_direct" }),
        getBranchConnectionString: async () => {
          throw new Error("direct mode must not request a branch connection string")
        },
      },
    })

    await writeSupabaseHandoff({
      workspaceRoot: branchingDir,
      runId: "run-branching",
      waveId: "wave-branching",
      projectRef: "proj_branching",
      dbMode: "branching",
      branchRef: "branch_live",
      secretStore: { storePath: branchingStorePath },
      client: {
        getProjectKeys: async () => ({ url: "https://branch.supabase.co", anonKey: "anon_branching", serviceRoleKey: "service_branching" }),
        getBranchConnectionString: async () => "postgres://branch_live",
      },
    })

    const directFiles = workspaceArtifacts(directDir)
    const branchingFiles = workspaceArtifacts(branchingDir)
    for (const file of directFiles) {
      assert.doesNotMatch(file.content, new RegExp(directToken), file.path)
    }
    for (const file of branchingFiles) {
      assert.doesNotMatch(file.content, new RegExp(branchingToken), file.path)
    }
  } finally {
    rmSync(directDir, { recursive: true, force: true })
    rmSync(branchingDir, { recursive: true, force: true })
  }
})
