import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { stagePresent } from "./stagePresentation.js"

export type MergeResolverHarness = {
  // Provider id matches `ResolvedHarness.provider` for stage agents.
  provider: "claude-code" | "codex" | "opencode" | "fake"
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

function buildPrompt(message: string, files: string[]): string {
  return [
    "You are resolving git merge conflicts in a workspace.",
    `The merge message describing this integration is: ${message}`,
    "",
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
  provider: MergeResolverHarness["provider"],
  model: string | undefined,
  workspaceRoot: string,
  prompt: string,
): { ok: true; command: string[] } | { ok: false; reason: string } {
  switch (provider) {
    case "claude-code": {
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
 * Attempt to resolve git merge conflicts in `workspaceRoot` using the
 * configured merge-resolver harness. Returns success when every previously-
 * conflicted file is free of conflict markers AND
 * `git diff --name-only --diff-filter=U` is empty. Caller is responsible for
 * `git add` + `git commit` to finalize the merge after a successful return.
 *
 * Disabled when `BEERENGINEER_DISABLE_LLM_MERGE_RESOLVER=1` or when `harness`
 * is undefined (e.g. running with `testingOverride: "fake"`).
 */
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
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
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
}): MergeResolverResult {
  if (process.env.BEERENGINEER_DISABLE_LLM_MERGE_RESOLVER === "1") {
    return { ok: false, reason: "llm-merge-resolver-disabled" }
  }
  if (!input.harness) {
    return { ok: false, reason: "merge-resolver: no harness configured" }
  }

  const conflicted = listConflictedFiles(input.workspaceRoot)
  if (conflicted.length === 0) {
    return { ok: true, resolvedFiles: [] }
  }

  const prompt = buildPrompt(input.mergeMessage, conflicted)
  const built = buildCommandForProvider(
    input.harness.provider,
    input.harness.model,
    input.workspaceRoot,
    prompt,
  )
  if (!built.ok) return built

  stagePresent.dim(
    `merge-resolver: ${input.harness.provider}${input.harness.model ? `/${input.harness.model}` : ""} on ${conflicted.length} conflicted file${conflicted.length === 1 ? "" : "s"}`,
  )

  // Resolver scales with conflict count: a 3-file story merge finishes in
  // ~3min, but a 6-file wave→project merge timed out at 7min because the
  // shared infra files (package.json, vitest.config.ts) plus diverged client
  // routes (app/w/[key]/page.tsx) need careful per-file reasoning. Empirically:
  // 90s baseline + 120s per file, capped at 30 minutes. Override with
  // `input.timeoutMs` when needed.
  const baseTimeoutMs = 90_000 + conflicted.length * 120_000
  const timeoutMs = input.timeoutMs ?? Math.min(baseTimeoutMs, 1_800_000)
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
  const addResult = !markerStillIn ? git(["add", "-A"], input.workspaceRoot) : { ok: false, stdout: "", stderr: "skipped: markers still present" }
  const remaining = addResult.ok ? listConflictedFiles(input.workspaceRoot) : conflicted
  const ok = result.status === 0 && !markerStillIn && addResult.ok && remaining.length === 0

  writeResolverLog(input.logDir, {
    provider: input.harness.provider,
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

  if (result.status !== 0) {
    const reason = result.signal
      ? `${input.harness.provider}-cli-signaled-${result.signal}`
      : `${input.harness.provider}-cli-exit-${result.status ?? "unknown"}`
    return { ok: false, reason: `${reason}: ${(result.stderr ?? "").slice(0, 400)}` }
  }
  if (markerStillIn) {
    return { ok: false, reason: `marker remains in ${markerStillIn}` }
  }
  if (!addResult.ok) {
    return { ok: false, reason: `git add -A failed: ${addResult.stderr.slice(0, 400)}` }
  }
  if (remaining.length > 0) {
    return { ok: false, reason: `conflicts remain after resolver: ${remaining.join(", ")}` }
  }
  return { ok: true, resolvedFiles: conflicted }
}
