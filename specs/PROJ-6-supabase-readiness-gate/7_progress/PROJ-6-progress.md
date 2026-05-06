# PROJ-6 Progress

## Status: in progress
## Current Wave: 1
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
