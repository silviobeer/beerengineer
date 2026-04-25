import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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
export function resolveMergeConflictsViaLlm(input: {
  workspaceRoot: string
  mergeMessage: string
  harness?: MergeResolverHarness
  timeoutMs?: number
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

  const timeoutMs = input.timeoutMs ?? 180_000
  const result = spawnSync(built.command[0], built.command.slice(1), {
    cwd: input.workspaceRoot,
    encoding: "utf8",
    timeout: timeoutMs,
  })
  if (result.status !== 0) {
    const reason = result.signal
      ? `${input.harness.provider}-cli-signaled-${result.signal}`
      : `${input.harness.provider}-cli-exit-${result.status ?? "unknown"}`
    return { ok: false, reason: `${reason}: ${(result.stderr ?? "").slice(0, 400)}` }
  }

  const remaining = listConflictedFiles(input.workspaceRoot)
  if (remaining.length > 0) {
    return { ok: false, reason: `conflicts remain after resolver: ${remaining.join(", ")}` }
  }
  for (const file of conflicted) {
    if (fileHasConflictMarkers(input.workspaceRoot, file)) {
      return { ok: false, reason: `marker remains in ${file}` }
    }
  }
  return { ok: true, resolvedFiles: conflicted }
}
