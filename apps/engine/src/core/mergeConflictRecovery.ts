import { readFile } from "node:fs/promises"
import type { RunRow } from "../db/repositories.js"
import { runGit } from "./git/shared.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

export type MergeConflictRecoveryArtifact = {
  type: "merge_conflict_recovery"
  itemId: string
  runId: string
  recordedAt: string
  recordedHeadSha: string
  conflictedPaths: string[]
}

export type MergeConflictResolutionValidationResult =
  | { ok: true; headSha: string }
  | {
      ok: false
      error: "merge_resolution_incomplete" | "manual_resolution_commit_required"
      message: string
    }

export function isStructuredMergeConflictRecoveryRun(
  run: Pick<RunRow, "recovery_status" | "recovery_scope" | "recovery_scope_ref" | "recovery_summary"> | null | undefined,
): boolean {
  if (!run) return false
  return run.recovery_status === "blocked"
    && run.recovery_scope === "stage"
    && run.recovery_scope_ref === "merge-gate"
    && typeof run.recovery_summary === "string"
    && /merge conflict blocked promotion/i.test(run.recovery_summary)
    && run.recovery_summary.includes("confirm_merge_resolved")
}

export function mergeConflictRecoveryArtifactPath(ctx: WorkflowContext): string {
  return `${layout.stageArtifactsDir(ctx, "merge-gate")}/merge-conflict-recovery.json`
}

export async function readMergeConflictRecoveryArtifact(
  ctx: WorkflowContext,
): Promise<MergeConflictRecoveryArtifact | null> {
  try {
    const raw = await readFile(mergeConflictRecoveryArtifactPath(ctx), "utf8")
    const parsed = JSON.parse(raw) as Partial<MergeConflictRecoveryArtifact>
    if (parsed.type !== "merge_conflict_recovery") return null
    if (typeof parsed.recordedHeadSha !== "string" || !parsed.recordedHeadSha.trim()) return null
    if (!Array.isArray(parsed.conflictedPaths)) return null
    return {
      type: "merge_conflict_recovery",
      itemId: String(parsed.itemId ?? ""),
      runId: String(parsed.runId ?? ""),
      recordedAt: String(parsed.recordedAt ?? ""),
      recordedHeadSha: parsed.recordedHeadSha,
      conflictedPaths: parsed.conflictedPaths.filter((path): path is string => typeof path === "string"),
    }
  } catch {
    return null
  }
}

export function validateMergeConflictResolution(
  workspaceRoot: string,
  artifact: MergeConflictRecoveryArtifact,
): MergeConflictResolutionValidationResult {
  const unmergedResult = runGit(workspaceRoot, ["diff", "--name-only", "--diff-filter=U"])
  if (!unmergedResult.ok) {
    throw new Error(`git: failed to inspect unmerged paths: ${unmergedResult.stderr || unmergedResult.stdout}`)
  }
  const unresolved = new Set(
    unmergedResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean),
  )
  const remaining = artifact.conflictedPaths.filter(path => unresolved.has(path))
  if (remaining.length > 0) {
    return {
      ok: false,
      error: "merge_resolution_incomplete",
      message: `Merge resolution is incomplete. Resolve and stage: ${remaining.join(", ")}.`,
    }
  }

  const headResult = runGit(workspaceRoot, ["rev-parse", "HEAD"])
  if (!headResult.ok || !headResult.stdout) {
    throw new Error(`git: failed to inspect HEAD: ${headResult.stderr || headResult.stdout}`)
  }
  const headSha = headResult.stdout.trim()
  if (headSha === artifact.recordedHeadSha) {
    return {
      ok: false,
      error: "manual_resolution_commit_required",
      message: "A manual resolution commit is required before confirmation.",
    }
  }

  const advancedResult = runGit(workspaceRoot, ["merge-base", "--is-ancestor", artifact.recordedHeadSha, "HEAD"])
  if (!advancedResult.ok) {
    return {
      ok: false,
      error: "manual_resolution_commit_required",
      message: "A manual resolution commit is required before confirmation.",
    }
  }

  return { ok: true, headSha }
}
