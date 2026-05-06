# PROJ-6-PRD-1: Pre-Execution Supabase Readiness

## Status: Planned

## User Stories

### US-1: Als Workflow Runtime moechte ich DB-relevante Plaene vor Execution erkennen um Supabase-Setup vor Worker-Start zu erzwingen
**Given** planning has produced waves with `dbRelevant` and `dbRelevantWave` metadata  
**When** a workflow reaches the point before execution waves begin  
**Then** the engine determines whether any planned wave is DB-relevant  
**And** if any wave is DB-relevant, the whole run is gated before the first execution wave starts

**Acceptance Criteria:**
- [ ] AC-1: The pre-execution readiness check runs after planning artifacts are available and before any execution worker, wave branch, or Supabase wave branch provisioning starts.
- [ ] AC-2: A plan with at least one `dbRelevant: true` story or `dbRelevantWave: true` wave is treated as DB-relevant even if earlier waves are non-DB-relevant.
- [ ] AC-3: A plan where all waves are explicitly non-DB-relevant bypasses Supabase pre-execution readiness and does not call Supabase Management API or adapter operations.
- [ ] AC-4: A validated plan with missing, legacy, or malformed DB relevance metadata is rejected or blocks before execution; it is never silently treated as non-DB-relevant.
- [ ] AC-5: The readiness payload includes DB relevance trigger context when called from execution, such as the first DB-relevant wave/story that caused the gate.
- [ ] AC-6: The new readiness module/function name is distinct from `supabaseWaveGate` and does not publish an exported function with the same name and a different signature.

### US-2: Als Operator moechte ich alle fehlenden Supabase-Voraussetzungen auf einmal sehen um Setup gezielt abzuschliessen
**Given** a DB-relevant run is missing one or more Supabase prerequisites  
**When** the pre-execution readiness check runs  
**Then** the engine returns a structured blocked readiness result  
**And** the result includes every locally-determinable missing setup action in one response

**Acceptance Criteria:**
- [ ] AC-7: Missing app-level Management API token returns the action label `Store management token`.
- [ ] AC-8: Missing workspace `supabase_project_ref` returns the action label `Connect Supabase project`.
- [ ] AC-9: Missing workspace persistent test branch ref returns the action label `Create persistent test branch`.
- [ ] AC-10: Invalid, revoked, expired, or HTTP 401 Management API token failures return `Rotate management token`, not `Store management token`.
- [ ] AC-11: HTTP 403 or equivalent permission-denied failures for an otherwise accepted token against the workspace project return `Re-authorize project access`, not `Rotate management token` or `Store management token`.
- [ ] AC-12: `Retry run` is not included in the missing setup action list; retry is represented separately as blocked-run recovery metadata.
- [ ] AC-13: Local prerequisite checks are collected in parallel where possible; network checks short-circuit when token/project/branch prerequisites are absent.

### US-3: Als Workflow Runtime moechte ich Supabase-Projektzugriff und Branch-Gesundheit live pruefen um nicht mit stale Workspace-Metadaten zu starten
**Given** a workspace has token metadata, project ref, and persistent branch ref  
**When** a DB-relevant run reaches pre-execution readiness  
**Then** the engine validates token access to the workspace project  
**And** it performs a bounded poll for the persistent branch to reach `ACTIVE_HEALTHY`

**Acceptance Criteria:**
- [ ] AC-14: Project access is validated for the run workspace's project ref, not merely by token presence.
- [ ] AC-15: Persistent branch health is checked through the PROJ-4 branch poller under `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS`.
- [ ] AC-16: `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` defaults to 60 seconds and is overrideable in tests without changing production behavior.
- [ ] AC-17: The bounded poll may treat transient provider states as pending during the poll.
- [ ] AC-18: Only `ACTIVE_HEALTHY` is a passing final persistent branch state for execution readiness.
- [ ] AC-19: Missing, degraded, unknown, provider-error, unauthorized, or timeout branch states produce a blocked readiness result instead of starting execution.
- [ ] AC-20: Setup/settings callers may expose a `checking` or recheck state, but execution converts an exhausted poll budget into a blocked run.

### US-4: Als Operator moechte ich nach behobenem Setup denselben blockierten Run fortsetzen um keine neuen Run-Artefakte zu erzeugen
**Given** a DB-relevant run is blocked by Supabase readiness after planning artifacts exist  
**When** the operator completes setup and retries  
**Then** the existing blocked run is re-entered at the pre-execution readiness point  
**And** readiness is evaluated from fresh workspace state before execution proceeds

**Acceptance Criteria:**
- [ ] AC-21: A blocked Supabase readiness run is marked `blocked`, not `failed`.
- [ ] AC-22: The blocked `runId` is reused on retry; retry does not create a new run as the normal success path.
- [ ] AC-23: Retry re-reads current workspace rows and re-runs readiness before dispatching workers.
- [ ] AC-24: Retry does not perform automatic Supabase project creation or silent setup mutations.
- [ ] AC-25: If readiness remains blocked after retry, the run remains blocked with an updated readiness payload.

### US-5: Als Maintainer moechte ich Workspace-Refs serverseitig erzwingen um Cross-Workspace-Supabase-Zugriffe zu verhindern
**Given** a client or retry request includes workspace/project/branch information  
**When** the engine evaluates Supabase readiness or performs adapter operations for this readiness path  
**Then** authoritative `projectRef` and `branchRef` values are read from the run/workspace rows  
**And** request-body refs cannot override server-side state

**Acceptance Criteria:**
- [ ] AC-26: The pre-execution check resolves the workspace from the run/item server-side state.
- [ ] AC-27: Request bodies cannot override workspace root, project ref, persistent branch ref, or branch name.
- [ ] AC-28: Before any Management API or adapter operation, `projectRef` and `branchRef` are cross-checked against the run/workspace row.
- [ ] AC-29: A token that can access workspace `beta` but not workspace `alpha` does not unblock an `alpha` run.

## Edge Cases

- A plan has wave 1 non-DB-relevant and wave 2 DB-relevant: the run blocks before wave 1 if Supabase readiness is missing.
- Planning emits legacy or malformed wave metadata: readiness must not silently assume DB-irrelevant if required `dbRelevant` metadata is absent from the validated plan shape.
- Supabase Management API is rate-limited or temporarily unavailable: execution blocks after the bounded poll/check budget with a redacted provider-safe message.
- Persistent branch is deleted outside beerengineer after setup: the next DB-relevant execution blocks with `Create persistent test branch`.
- Token is rotated externally or revoked: project access fails for the specific workspace and returns token rotation/reauthorization action.

## Abhaengigkeiten

- Benoetigt: PROJ-4 Supabase capability, persistent branch, and wave branch lifecycle foundations.
- Benoetigt: PROJ-5 blocked-run/recovery precedent for run-level blocked state and retry semantics.
- Blocks: PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

## Technische Anforderungen

- The readiness result must be structured enough for CLI, API, and UI to render identical missing setup actions.
- Provider messages shown to users must be redacted and safe.
- The Management API token remains app-level, but all access validation is workspace-specific.
- No new Supabase readiness code path may import UI modules or trust browser-supplied path/ref fields.
- The readiness model is a strict superset of existing `supabaseCapability` checks and must consume/delegate to that capability where the port shape fits; it must not duplicate a parallel token/project presence model.
