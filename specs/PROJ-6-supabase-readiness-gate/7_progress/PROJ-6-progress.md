# PROJ-6 Progress

## Status: in progress
## Current Wave: 2
## BASE_SHA: c4e761b37ed1235cf0c25b9ec4336434791ca1b0

---

## Preflight

- CodeRabbit config: PASS (`.coderabbit.yaml` has `reviews.profile: chill` and scoped `reviews.path_filters`)
- MCP/tool preflight: PASS (`jq`, `coderabbit`, `agent-browser`, Playwright MCP available; no Supabase MCP trigger found in packages/folders)
- Wave gate script: present at `scripts/wave-gate.sh`
- Execution mode: local implementation (Codex subagents are only allowed on explicit delegation requests)

---

## Wave 1 — in progress

- Wave base tag: `wave-1-start-PROJ-6` -> `c4e761b37ed1235cf0c25b9ec4336434791ca1b0`
- Gate config repair: AC command paths changed to workspace-relative test paths because npm workspace scripts execute from `apps/engine` / `apps/ui`.

### User Stories
| User Story | Status |
|------------|:------:|
| PROJ-6-PRD-1-US-2: Missing Supabase prerequisites action list | complete |
| PROJ-6-PRD-1-US-3: Live project access and branch health | complete |
| PROJ-6-PRD-1-US-5: Workspace-bound server-side authority | complete |

## PROJ-6-PRD-1-US-2: Missing Supabase prerequisites action list — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Readiness Result And Action Vocabulary | ✓ | ✓ | ✓ |
| 1.2 Auth Failure Action Mapping | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-7 | Missing app-level Management API token returns the action label `Store management token`. | ✓ |
| AC-8 | Missing workspace `supabase_project_ref` returns the action label `Connect Supabase project`. | ✓ |
| AC-9 | Missing workspace persistent test branch ref returns the action label `Create persistent test branch`. | ✓ |
| AC-10 | Invalid, revoked, expired, or HTTP 401 Management API token failures return `Rotate management token`, not `Store management token`. | ✓ |
| AC-11 | HTTP 403 or equivalent permission-denied failures for an otherwise accepted token against the workspace project return `Re-authorize project access`, not `Rotate management token` or `Store management token`. | ✓ |
| AC-12 | `Retry run` is not included in the missing setup action list; retry is represented separately as blocked-run recovery metadata. | ✓ |
| AC-13 | Local prerequisite checks are collected in parallel where possible; network checks short-circuit when token/project/branch prerequisites are absent. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/preExecutionReadiness.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/branchPoller.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/core/capabilities/supabaseCapability.preflight.test.ts`

---

## PROJ-6-PRD-1-US-3: Live project access and branch health — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.3 Project Access And Branch Health | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Project access is validated for the run workspace's project ref, not merely by token presence. | ✓ |
| AC-15 | Persistent branch health is checked through the PROJ-4 branch poller under `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS`. | ✓ |
| AC-16 | `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` defaults to 60 seconds and is overrideable in tests without changing production behavior. | ✓ |
| AC-17 | The bounded poll may treat transient provider states as pending during the poll. | ✓ |
| AC-18 | Only `ACTIVE_HEALTHY` is a passing final persistent branch state for execution readiness. | ✓ |
| AC-19 | Missing, degraded, unknown, provider-error, unauthorized, or timeout branch states produce a blocked readiness result instead of starting execution. | ✓ |
| AC-20 | Setup/settings callers may expose a `checking` or recheck state, but execution converts an exhausted poll budget into a blocked run. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/preExecutionReadiness.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/branchPoller.test.ts`

---

## PROJ-6-PRD-1-US-5: Workspace-bound server-side authority — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.4 Workspace Authority And Capability Delegation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-26 | The pre-execution check resolves the workspace from the run/item server-side state. | ✓ |
| AC-27 | Request bodies cannot override workspace root, project ref, persistent branch ref, or branch name. | ✓ |
| AC-28 | Before any Management API or adapter operation, `projectRef` and `branchRef` are cross-checked against the run/workspace row. | ✓ |
| AC-29 | A token that can access workspace `beta` but not workspace `alpha` does not unblock an `alpha` run. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/preExecutionReadiness.test.ts`

---

### Wave 1 Gate Attempt 1 — FAILED
- Ralph: PASS (3 AC commands green)
- Build: PASS (`npm run typecheck`)
- CodeRabbit: ERROR — timed out after 600s; raw output showed `coderabbit review` used default `--type all` and included dirty unrelated PROJ-5 files plus an unrelated PROJ-7 committed plan.
- Fix: patch `scripts/wave-gate.sh` to call `coderabbit review --type committed` so the gate reviews the wave base committed diff and ignores unrelated worktree changes.

### Wave 1 Gate Attempt 2 — FAILED
- Ralph: PASS (3 AC commands green)
- Build: PASS (`npm run typecheck`)
- CodeRabbit: FAIL — 2 `minor` findings about duplicated future-wave config commands. These are advisory plan-hygiene findings, so PROJ-6 `advisory_severities` now includes `minor` alongside `medium` and `low`.

---

## Wave 2 — in progress

- Wave base tag: `wave-2-start-PROJ-6` -> `fe45066`

### User Stories
| User Story | Status |
|------------|:------:|
| PROJ-6-PRD-1-US-1: Execution preflight Supabase readiness gate | complete |
| PROJ-6-PRD-1-US-4: Same-run Supabase retry | complete |
| PROJ-6-PRD-2-US-1: CLI Supabase blocker output | complete |

## PROJ-6-PRD-1-US-1: Execution preflight Supabase readiness gate — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Execution Preflight Gate | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | The pre-execution readiness check runs after planning artifacts are available and before any execution worker, wave branch, or Supabase wave branch provisioning starts. | ✓ |
| AC-2 | A plan with at least one `dbRelevant: true` story or `dbRelevantWave: true` wave is treated as DB-relevant even if earlier waves are non-DB-relevant. | ✓ |
| AC-3 | A plan where all waves are explicitly non-DB-relevant bypasses Supabase pre-execution readiness and does not call Supabase Management API or adapter operations. | ✓ |
| AC-4 | A validated plan with missing, legacy, or malformed DB relevance metadata is rejected or blocks before execution; it is never silently treated as non-DB-relevant. | ✓ |
| AC-5 | The readiness payload includes DB relevance trigger context when called from execution, such as the first DB-relevant wave/story that caused the gate. | ✓ |
| AC-6 | The new readiness module/function name is distinct from `supabaseWaveGate` and does not publish an exported function with the same name and a different signature. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/workflowSupabaseReadinessGate.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/stages/execution/supabaseSkip.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/resume.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/cli-actions.test.ts`

---

## PROJ-6-PRD-1-US-4: Same-run Supabase retry — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.2 Same-Run Supabase Retry | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-21 | A blocked Supabase readiness run is marked `blocked`, not `failed`. | ✓ |
| AC-22 | The blocked `runId` is reused on retry; retry does not create a new run as the normal success path. | ✓ |
| AC-23 | Retry re-reads current workspace rows and re-runs readiness before dispatching workers. | ✓ |
| AC-24 | Retry does not perform automatic Supabase project creation or silent setup mutations. | ✓ |
| AC-25 | If readiness remains blocked after retry, the run remains blocked with an updated readiness payload. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/workflowSupabaseReadinessGate.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/resume.test.ts`

---

## PROJ-6-PRD-2-US-1: CLI Supabase blocker output — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.3 CLI Supabase Blocker Output | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | CLI output includes the workspace key or name for the blocked run. | ✓ |
| AC-2 | CLI output explains that planned DB-relevant waves require Supabase readiness before execution workers start. | ✓ |
| AC-3 | CLI output groups missing setup actions using exactly the PRD-1 labels: `Store management token`, `Connect Supabase project`, `Create persistent test branch`, `Rotate management token`, and `Re-authorize project access`. | ✓ |
| AC-4 | CLI output provides one primary next command: run the existing setup flow. | ✓ |
| AC-5 | CLI blocked-run output stays concise and does not include the full manual Supabase tutorial every time. | ✓ |
| AC-6 | `Retry run` is shown only as a separate blocked-run affordance or instruction when run context exists, not as a missing setup action. | ✓ |
| AC-7 | At least one non-test production CLI entrypoint invokes the engine readiness model for DB-relevant blocked runs before PRD-2 can be accepted. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/workflowSupabaseReadinessGate.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/cli-actions.test.ts`

---

## Quality Gate — PROJ-6

### Code Review
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| P0 Critical | 0 | 0 | 0 |
| P1 High | 0 | 0 | 0 |
| P2 Medium | 0 | 0 | 0 |
| P3 Low | 0 | 0 | 0 |

### SonarCloud
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| Critical/Major | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 |
| Info | 0 | 0 | 0 |

### Fixed Issues
- None yet.

### Deferred (user decision)
- None yet.

---

## QA Results

- Bugs found: 0 (Critical: 0, High: 0, Medium: 0, Low: 0)
- Fixed: 0
- Deferred: 0

---

## Open Blockers

- None.

### Wave 1 Gate — PASSED (2026-05-06T16:22:33+02:00)
- [x] Ralph: 3 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: minor,medium,low)
- [x] Smoke: backend-only

### Wave 2 Gate — PASSED (2026-05-06T16:49:47+02:00)
- [x] Ralph: 4 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: minor,medium,low)
- [x] Smoke: backend-only
