import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { stagePresent } from "./stagePresentation.js"

export type MergeResolverHarness = {
  /**
   * Harness brand. Matches `ResolvedHarness.harness` from the LLM registry
   * for the hosted variant; "fake" is allowed so the testing-override path
   * can pass a no-op resolver through without ceremony.
   */
  harness: "claude" | "codex" | "opencode" | "fake"
  /**
   * Invocation runtime. The resolver is currently CLI-only because
   * `resolveMergeConflictsViaLlm` runs synchronously inside the sync
   * `GitAdapter.mergeStoryIntoWave` path. Profiles that select
   * `runtime: "sdk"` for the merge-resolver role are rejected with a
   * clear error rather than silently degrading to CLI — the operator
   * either accepts CLI for merge-resolver or waits for the async
   * conversion to land.
   */
  runtime?: "cli" | "sdk"
  model?: string
}

export type MergeResolverResult =
  | { ok: true; resolvedFiles: string[] }
  | { ok: false; reason: string }

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function listConflictedFiles(root: string): string[] {
  const result = git(["diff", "--name-only", "--diff-filter=U"], root)
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

function fileHasConflictMarkers(root: string, file: string): boolean {
  try {
    const content = readFileSync(join(root, file), "utf8")
    return /^<{7} |^={7}$|^>{7} /m.test(content)
  } catch {
    return false
  }
}

function buildPrompt(message: string, files: string[], expectedSharedFiles: string[] = []): string {
  return [
    "You are resolving git merge conflicts in a workspace.",
    `The merge message describing this integration is: ${message}`,
    "",
    ...(expectedSharedFiles.length > 0
      ? [
          "The following files are expected to be touched by multiple stories in this wave; treat conflicts on them as union-merges rather than logic conflicts:",
          ...expectedSharedFiles.map(file => `  - ${file}`),
          "Conflicts on any other path are unexpected and should be treated as suspicious.",
          "",
        ]
      : []),
    `The following files have conflict markers (<<<<<<<, =======, >>>>>>>):`,
    ...files.map(f => `  - ${f}`),
    "",
    "For each conflicted file, edit it in place to remove all conflict markers and produce a coherent result.",
    "When two stories add different items to the same list (dependencies, imports, exports, config keys), keep the union — both stories' contributions belong.",
    "When two stories propose mutually exclusive logic on the same lines, keep the version that better preserves both stories' intent or, if forced to choose, the version with broader coverage.",
    "Do NOT delete code that one side added unless it is duplicated by the other side.",
    "Do NOT introduce new behavior that neither side had.",
    "After editing, ensure none of the conflicted files contain '<<<<<<<', '=======', or '>>>>>>>' markers.",
    "",
    "Return exactly one JSON object: { \"summary\": string, \"resolvedFiles\": string[] }",
    "Do not wrap the response in markdown fences.",
  ].join("\n")
}

function buildCommandForProvider(
  harness: MergeResolverHarness["harness"],
  model: string | undefined,
  workspaceRoot: string,
  prompt: string,
): { ok: true; command: string[] } | { ok: false; reason: string } {
  switch (harness) {
    case "claude": {
      const command = [
        "claude",
        "--print",
        "--output-format",
        "json",
        "--permission-mode",
        "acceptEdits",
        "--add-dir",
        workspaceRoot,
      ]
      if (model) command.push("--model", model)
      command.push(prompt)
      return { ok: true, command }
    }
    case "codex": {
      const command = [
        "codex",
        "exec",
        "--cd",
        workspaceRoot,
        "--sandbox",
        "workspace-write",
      ]
      if (model) command.push("-c", `model=${JSON.stringify(model)}`)
      command.push(prompt)
      return { ok: true, command }
    }
    case "opencode":
      return { ok: false, reason: "merge-resolver: opencode provider not implemented yet" }
    case "fake":
      return { ok: false, reason: "merge-resolver: fake provider — skipped" }
  }
}

/**
 * Optional sink for resolver telemetry. The execution stage passes a
 * directory path; we write `merge-resolver.log.txt` there with the prompt,
 * stdout, stderr, and the conflicted-file list so a failed run leaves a
 * trail you can read instead of having to re-run with extra logging.
 */
function writeResolverLog(logDir: string | undefined, payload: Record<string, unknown>): void {
  if (!logDir) return
  try {
    mkdirSync(dirname(join(logDir, "merge-resolver.log.txt")), { recursive: true })
    mkdirSync(logDir, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    const file = join(logDir, `merge-resolver.${stamp}.json`)
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8")
  } catch {
    // Telemetry must not block resolution.
  }
}

export function resolveMergeConflictsViaLlm(input: {
  workspaceRoot: string
  mergeMessage: string
  harness?: MergeResolverHarness
  timeoutMs?: number
  logDir?: string
  expectedSharedFiles?: string[]
}): MergeResolverResult {
  if (process.env.BEERENGINEER_DISABLE_LLM_MERGE_RESOLVER === "1") {
    return { ok: false, reason: "llm-merge-resolver-disabled" }
  }
  if (!input.harness) {
    return { ok: false, reason: "merge-resolver: no harness configured" }
  }
  if (input.harness.runtime === "sdk") {
    return {
      ok: false,
      reason:
        `merge-resolver: ${input.harness.harness}:sdk is not implemented (the resolver runs synchronously inside the git adapter; SDK adapters are async). ` +
        `Configure the merge-resolver role to runtime: "cli" — the SDK runtime for coder/reviewer is unaffected.`,
    }
  }

  const conflicted = listConflictedFiles(input.workspaceRoot)
  if (conflicted.length === 0) {
    return { ok: true, resolvedFiles: [] }
  }

  const prompt = buildPrompt(input.mergeMessage, conflicted, input.expectedSharedFiles)
  const built = buildCommandForProvider(
    input.harness.harness,
    input.harness.model,
    input.workspaceRoot,
    prompt,
  )
  if (!built.ok) return built

  const modelSuffix = input.harness.model ? `/${input.harness.model}` : ""
  const fileLabel = conflicted.length === 1 ? "file" : "files"
  stagePresent.dim(`merge-resolver: ${input.harness.harness}${modelSuffix} on ${conflicted.length} conflicted ${fileLabel}`)

  // Resolver scales with conflict count: a 3-file story merge finishes in
  // ~3min, but a 6-file wave→project merge timed out at 7min because the
  // shared infra files (package.json, vitest.config.ts) plus diverged client
  // routes (app/w/[key]/page.tsx) need careful per-file reasoning. Empirically:
  // 90s baseline + 120s per file, capped at 30 minutes. Override per call via
  // `input.timeoutMs`, or per environment via the BEERENGINEER_MERGE_RESOLVER_*
  // env vars below — useful for bumping budgets without recompiling.
  const baselineMs = readPositiveIntEnv("BEERENGINEER_MERGE_RESOLVER_BASE_MS", 90_000)
  const perFileMs = readPositiveIntEnv("BEERENGINEER_MERGE_RESOLVER_PER_FILE_MS", 120_000)
  const capMs = readPositiveIntEnv("BEERENGINEER_MERGE_RESOLVER_CAP_MS", 1_800_000)
  const computedTimeoutMs = Math.min(baselineMs + conflicted.length * perFileMs, capMs)
  const timeoutMs = input.timeoutMs ?? computedTimeoutMs
  const startedAt = Date.now()
  const result = spawnSync(built.command[0], built.command.slice(1), {
    cwd: input.workspaceRoot,
    encoding: "utf8",
    timeout: timeoutMs,
  })
  const durationMs = Date.now() - startedAt

  // Order matters here. The resolver mutates working-tree files; the index
  // still records them as unmerged until we `git add`. So:
  //   1. Check working-tree files for conflict markers (cheap correctness gate).
  //   2. `git add -A` to take the resolution into the index.
  //   3. NOW ask git for unmerged paths — only after staging is the index honest.
  // Inverting (2) and (3) caused every successful resolution to look failed.
  const markerStillIn = conflicted.find(file => fileHasConflictMarkers(input.workspaceRoot, file))
  const addResult = markerStillIn
    ? { ok: false, stdout: "", stderr: "skipped: markers still present" }
    : git(["add", "-A"], input.workspaceRoot)
  const remaining = addResult.ok ? listConflictedFiles(input.workspaceRoot) : conflicted
  const noConflictMarkersRemain = markerStillIn === undefined
  // Trust the post-resolution filesystem state, not the CLI exit code. A
  // sonnet timeout (SIGTERM=143) sometimes lands AFTER the model has written
  // clean files; rejecting on exit !== 0 throws away a valid resolution.
  const ok = noConflictMarkersRemain && addResult.ok && remaining.length === 0

  writeResolverLog(input.logDir, {
    harness: input.harness.harness,
    model: input.harness.model,
    workspaceRoot: input.workspaceRoot,
    mergeMessage: input.mergeMessage,
    conflicted,
    command: built.command,
    durationMs,
    exitStatus: result.status,
    signal: result.signal ?? null,
    stdoutSnippet: (result.stdout ?? "").slice(0, 4000),
    stderrSnippet: (result.stderr ?? "").slice(0, 4000),
    addOk: addResult.ok,
    addStderr: addResult.stderr.slice(0, 400),
    remainingAfter: remaining,
    markerStillIn: markerStillIn ?? null,
    ok,
  })

  if (markerStillIn) {
    return { ok: false, reason: `marker remains in ${markerStillIn}` }
  }
  if (!addResult.ok) {
    return { ok: false, reason: `git add -A failed: ${addResult.stderr.slice(0, 400)}` }
  }
  if (remaining.length > 0) {
    return { ok: false, reason: `conflicts remain after resolver: ${remaining.join(", ")}` }
  }
  // Filesystem says clean, index says clean — accept regardless of CLI exit.
  return { ok: true, resolvedFiles: conflicted }
}
