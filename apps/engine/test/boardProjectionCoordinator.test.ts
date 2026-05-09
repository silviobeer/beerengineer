import assert from "node:assert/strict"
import { test } from "node:test"

import { createBoardProjectionCoordinator } from "../src/api/boardProjectionCoordinator.js"
import type { BoardProjectionProjectors } from "../src/api/boardProjectionTypes.js"

test("REQ-10-3 board coordinator composes five concern-owned projector contracts", () => {
  const calls: string[] = []
  const projectors = {
    placementProjector: () => {
      calls.push("placement")
      return {
        column: "implementation",
        phaseStatus: "running",
        currentStage: "execution",
      }
    },
    promptProjector: () => {
      calls.push("prompts")
      return {
        hasOpenPrompt: true,
        hasReviewGateWaiting: true,
      }
    },
    recoveryProjector: () => {
      calls.push("recovery")
      return {
        hasBlockedRun: true,
        recovery_user_message: "Worker lost. Resume this run to continue.",
      }
    },
    supabaseProjector: () => {
      calls.push("supabase")
      return {
        supabaseBlocker: {
          status: "blocked" as const,
          label: "Supabase blocked" as const,
          runId: "run-1",
          workspace: { id: "ws-1", key: "alpha" },
          missingSetupActions: ["Rotate management token"],
          message: "Supabase readiness blocked planned DB-relevant work.",
          retry: { available: true, ready: false },
        },
        dbRelevance: {
          value: true,
          source: "detector" as const,
          reason: "Supabase branch provisioned",
        },
        supabaseProjectRef: "sb-alpha",
        supabaseBranch: {
          ref: "branch_merge",
          name: "feature/merge",
          lifecycleState: "retained-for-diagnosis",
        },
      }
    },
    mergeStateProjector: () => {
      calls.push("merge-state")
      return {
        column: "merge",
        phaseStatus: "review_required",
        currentStage: "merge-gate",
        latestRunId: "run-1",
      }
    },
  } satisfies BoardProjectionProjectors

  assert.deepEqual(Object.keys(projectors).sort(), [
    "mergeStateProjector",
    "placementProjector",
    "promptProjector",
    "recoveryProjector",
    "supabaseProjector",
  ])

  const coordinator = createBoardProjectionCoordinator(projectors)
  const card = coordinator.projectCard({
    workspace: {
      id: "ws-1",
      key: "alpha",
      root_path: "/tmp/alpha",
      supabase_project_ref: "sb-alpha",
    },
    item: {
      id: "item-1",
      code: "ITEM-0001",
      title: "Merge gate overlap",
      description: "prompt + blocker + branch",
      current_column: "merge",
      phase_status: "review_required",
      current_stage: "merge-gate",
    },
    latestRun: {
      id: "run-1",
      item_id: "item-1",
      status: "blocked",
      recovery_status: "blocked",
      recovery_summary: "Supabase readiness blocked planned DB-relevant work.",
      recovery_scope_ref: null,
      recovery_payload_json: "{}",
      workspace_fs_id: "workspace-fs",
      supabase_branch_ref: "branch_merge",
      supabase_branch_name: "feature/merge",
      supabase_branch_lifecycle_state: "retained-for-diagnosis",
    },
    openPrompt: { actions_json: "[{\"value\":\"promote\"}]" },
    projectCount: 2,
  })

  assert.deepEqual(calls, ["placement", "prompts", "recovery", "supabase", "merge-state"])
  assert.equal(card.itemCode, "ITEM-0001")
  assert.equal(card.column, "merge")
  assert.equal(card.phaseStatus, "review_required")
  assert.equal(card.currentStage, "merge-gate")
  assert.equal(card.hasOpenPrompt, true)
  assert.equal(card.hasReviewGateWaiting, true)
  assert.equal(card.hasBlockedRun, true)
  assert.equal(card.latestRunId, "run-1")
  assert.equal(card.workspaceId, "ws-1")
  assert.equal(card.workspaceRoot, "/tmp/alpha")
  assert.equal(card.supabaseProjectRef, "sb-alpha")
  assert.deepEqual(card.meta, [
    { label: "phase", value: "review_required" },
    { label: "projects", value: "2" },
  ])
})
