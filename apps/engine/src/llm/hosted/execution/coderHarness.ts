import { readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import type { StoryExecutionContext } from "../../../types.js"
import type { HostedRequest, IterationContext } from "../promptEnvelope.js"
import { buildExecutionPrompt } from "../promptEnvelope.js"
import { invokeHostedCli, parseJsonObject } from "../hostedCliAdapter.js"
import type { HostedSession } from "../providerRuntime.js"
import type { ResolvedHarness, RuntimePolicy } from "../../registry.js"

type GitBaseline = {
  headSha: string | null
  untrackedFiles: string[]
}

type CoderHarnessOutput = {
  summary: string
  testsRun: Array<{ command: string; status: "passed" | "failed" | "not_run" }>
  implementationNotes: string[]
  blockers: string[]
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { ok: result.status === 0, stdout: result.stdout?.trim() ?? "" }
}

function listUntrackedFiles(workspaceRoot: string): string[] {
  const result = runGit(["ls-files", "--others", "--exclude-standard"], workspaceRoot)
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

export function shouldIgnoreTransientUntrackedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  return (
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".beerengineer" ||
    normalized.startsWith(".beerengineer/")
  )
}

export async function ensureGitBaseline(workspaceRoot: string, baselinePath: string): Promise<GitBaseline> {
  try {
    return JSON.parse(await readFile(baselinePath, "utf8")) as GitBaseline
  } catch {
    const head = runGit(["rev-parse", "HEAD"], workspaceRoot)
    const baseline: GitBaseline = {
      headSha: head.ok && head.stdout ? head.stdout : null,
      untrackedFiles: listUntrackedFiles(workspaceRoot),
    }
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
    return baseline
  }
}

function collectChangedFiles(workspaceRoot: string, baseline: GitBaseline): string[] {
  const tracked = baseline.headSha
    ? runGit(["diff", "--name-only", baseline.headSha], workspaceRoot).stdout
    : runGit(["status", "--porcelain"], workspaceRoot).stdout
        .split(/\r?\n/)
        .map(line => line.slice(3).trim())
        .filter(Boolean)
        .join("\n")
  const currentUntracked = listUntrackedFiles(workspaceRoot)
  const baselineUntracked = new Set(baseline.untrackedFiles)
  const untrackedDelta = currentUntracked.filter(
    path => !baselineUntracked.has(path) && !shouldIgnoreTransientUntrackedPath(path),
  )
  /* c8 ignore next 2 -- deterministic ordering only */
  return Array.from(new Set([...tracked.split(/\r?\n/).map(line => line.trim()).filter(Boolean), ...untrackedDelta]))
    .sort((left, right) => left.localeCompare(right))
}

export async function runCoderHarness(input: {
  harness: ResolvedHarness
  runtimePolicy: RuntimePolicy
  baselinePath: string
  storyContext: StoryExecutionContext
  reviewFeedback?: string
  sessionId?: string | null
  iterationContext?: IterationContext
}): Promise<CoderHarnessOutput & { changedFiles: string[]; sessionId: string | null }> {
  if (input.harness.kind === "fake") {
    throw new Error("Unsupported execution harness: fake")
  }
  if (input.harness.harness === "opencode") {
    throw new Error("Unsupported execution harness: opencode")
  }
  const { harness, runtime, provider, model, workspaceRoot } = input.harness
  const baseline = await ensureGitBaseline(workspaceRoot, input.baselinePath)
  const request: HostedRequest = {
    kind: "execution",
    runtime: {
      harness,
      runtime,
      provider,
      model,
      workspaceRoot,
      policy: input.runtimePolicy,
    },
    prompt: buildExecutionPrompt({
      harness,
      runtime,
      model,
      runtimePolicy: input.runtimePolicy,
      storyId: input.storyContext.story.id,
      action: input.reviewFeedback ? "fix" : "implement",
      iterationContext: input.iterationContext,
      payload: {
        storyContext: input.storyContext,
        reviewFeedback: input.reviewFeedback ?? null,
      },
    }),
    payload: {
      storyContext: input.storyContext,
      reviewFeedback: input.reviewFeedback ?? null,
    },
  }
  const result = await invokeHostedCli(
    request,
    { harness, sessionId: input.sessionId ?? null } satisfies HostedSession,
  )
  const parsed = parseJsonObject(result.outputText) as CoderHarnessOutput
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "Execution completed.",
    testsRun: Array.isArray(parsed.testsRun) ? parsed.testsRun : [],
    implementationNotes: Array.isArray(parsed.implementationNotes) ? parsed.implementationNotes : [],
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    changedFiles: collectChangedFiles(input.harness.workspaceRoot, baseline),
    sessionId: result.session.sessionId,
  }
}
