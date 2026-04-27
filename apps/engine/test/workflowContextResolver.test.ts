import { test } from "node:test"
import assert from "node:assert/strict"

import {
  requireWorkflowContextForRun,
  resolveWorkflowContextForItemRun,
  resolveWorkflowContextForRun,
  resolveWorkspaceRootForWorkspaceId,
} from "../src/core/workflowContextResolver.js"
import type { Repos, WorkspaceRow } from "../src/db/repositories.js"

function stubRepos(workspaces: Map<string, WorkspaceRow>): Repos {
  return {
    getWorkspace(id: string) {
      return workspaces.get(id)
    },
  } as unknown as Repos
}

const baseRun = {
  id: "run-42",
  workspace_id: "ws-1",
  workspace_fs_id: "demo-fs",
}

test("resolveWorkflowContextForRun returns null when the workspace row is missing (fail-closed for pre-cutover runs)", () => {
  const repos = stubRepos(new Map())
  assert.equal(resolveWorkflowContextForRun(repos, baseRun), null)
})

test("resolveWorkflowContextForRun returns null when workspace_fs_id is null", () => {
  const repos = stubRepos(
    new Map([["ws-1", { id: "ws-1", root_path: "/tmp/ws-1" } as WorkspaceRow]]),
  )
  assert.equal(
    resolveWorkflowContextForRun(repos, { ...baseRun, workspace_fs_id: null as unknown as string }),
    null,
  )
})

test("resolveWorkflowContextForRun returns null when the workspace row has no root_path", () => {
  const repos = stubRepos(
    new Map([["ws-1", { id: "ws-1", root_path: null } as unknown as WorkspaceRow]]),
  )
  assert.equal(resolveWorkflowContextForRun(repos, baseRun), null)
})

test("resolveWorkflowContextForRun returns the registered workspace root, never cwd", () => {
  const repos = stubRepos(
    new Map([["ws-1", { id: "ws-1", root_path: "/tmp/ws-1" } as WorkspaceRow]]),
  )
  const ctx = resolveWorkflowContextForRun(repos, baseRun)
  assert.deepEqual(ctx, {
    workspaceId: "demo-fs",
    runId: "run-42",
    workspaceRoot: "/tmp/ws-1",
  })
})

test("requireWorkflowContextForRun throws artefacts_unreachable when the workspace row is missing", () => {
  const repos = stubRepos(new Map())
  assert.throws(() => requireWorkflowContextForRun(repos, baseRun), /artefacts_unreachable:run-42/)
})

test("resolveWorkflowContextForItemRun fails closed when the item's workspace is missing", () => {
  const repos = stubRepos(new Map())
  const ctx = resolveWorkflowContextForItemRun(
    repos,
    { workspace_id: "ws-missing" },
    { id: "run-1", workspace_fs_id: "demo-fs" },
  )
  assert.equal(ctx, null)
})

test("resolveWorkspaceRootForWorkspaceId returns null for a missing workspace row", () => {
  const repos = stubRepos(new Map())
  assert.equal(resolveWorkspaceRootForWorkspaceId(repos, "ws-missing"), null)
})
