/**
 * BUG-PROJ4-QA-005: SupabaseWorkflowHook — the integration layer that routes
 * the workflow through the Supabase gate helpers (PRD-5/6/7).
 *
 * Design intent (per Rodriguez retrospective): keep gate functions pure /
 * testable; this object is the glue that carries repos+adapter+workspace into
 * the wiring points without coupling workflow.ts to every gate module.
 *
 * Constructed once per run by `buildSupabaseWorkflowHook` (in server.ts /
 * runOrchestrator) and passed as an optional parameter throughout.  When
 * `undefined`, every wiring point is a no-op so existing tests and non-
 * Supabase runs are unaffected.
 */

import type { Repos } from "../../db/repositories.js"
import type { SecretStoreOptions } from "../../setup/secretStore.js"
import type { SupabaseReadinessManagementClient } from "./preExecutionReadiness.js"
import type { SupabaseAdapter } from "./types.js"
import type { SupabaseHandoffClient } from "./handoffWriter.js"

export type SupabaseWorkflowReadinessHook = {
  repos: Repos
  runId: string
  secretStore?: SecretStoreOptions
  managementClient?: SupabaseReadinessManagementClient
}

export type SupabaseWorkflowHook = {
  repos: Repos
  adapter: SupabaseAdapter
  workspaceId: string
  projectRef: string
  /** Persistent test branch that is the parent for every wave branch. */
  parentBranchRef: string
  protectionSwitch: "off" | "on"
  cleanupPolicy: "on-success-immediate" | "ttl-after-success" | "manual"
  cleanupTtlHours?: number | null
  /** Optional: when present, handoff dotenvs are written after provisioning. */
  handoffClient?: SupabaseHandoffClient
}
