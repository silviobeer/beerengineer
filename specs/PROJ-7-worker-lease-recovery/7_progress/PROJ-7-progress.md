# PROJ-7 Progress

## Status: in progress
## Current Wave: 1
## BASE_SHA: fe45066553649e406d8fc6eb11dd61cb9aee5af6

---

## Preflight

- Worktree: `/home/silvio/projects/beerengineer2-proj-7-worker-lease-recovery`
- Branch: `feat/proj-7-worker-lease-recovery`
- CodeRabbit config: PASS (`.coderabbit.yaml` has `reviews.profile: chill` and focused path filters)
- MCP preflight: PASS (no Supabase package/folder; Playwright MCP available for wave 4 frontend smoke route)
- Required CLIs: PASS (`jq`, `coderabbit`, `agent-browser`)
- Wave gate script: PASS (`scripts/wave-gate.sh`)

---

## Wave 1

Status: in progress

- Dependency map read:
  - Wave 1: PROJ-7-PRD-1-US-3
  - Wave 2: PROJ-7-PRD-1-US-1, US-2, US-4, US-5
  - Wave 3: PROJ-7-PRD-2-US-1, US-2, US-3, US-4, US-6
  - Wave 4: PROJ-7-PRD-3-US-1, US-2, PROJ-7-PRD-2-US-5, PROJ-7-PRD-3-US-3, US-4, US-5, US-6
- Wave base tag: `wave-1-start-PROJ-7` at `fe45066553649e406d8fc6eb11dd61cb9aee5af6`

## PROJ-7-PRD-1-US-3: Worker ownership fields for future queue migration — in progress

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Run Lease Schema And Types | ✓ | ✓ | ✓ |
| 1.2 Lease Repository Primitives | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-11 | Running workflow runs persist `worker_instance_id`. | ✓ |
| AC-12 | Running workflow runs persist `worker_owner_kind`. | ✓ |
| AC-13 | Running workflow runs persist `worker_started_at`. | ✓ |
| AC-14 | Running workflow runs persist `worker_heartbeat_at`. | ✓ |
| AC-15 | PROJ-7 does not require a workflow job table, worker queue table, or automatic job reclaimer. | ✓ |

### Ralph Loop
- Iterations: 1

### TDD Notes
- RED: `npm run test:file --workspace=@beerengineer/engine -- test/workerLease.test.ts` failed because `apps/engine/src/core/workerLease.js` does not exist yet.
- GREEN: `npm run test:file --workspace=@beerengineer/engine -- test/workerLease.test.ts` passed 5 tests.
- Related regression: `npm run test:file --workspace=@beerengineer/engine -- test/reposOwnerAndIds.test.ts` passed 5 tests.
- Typecheck: `npm run typecheck` passed.
- Agent notes: wrote `apps/engine/src/core/agent.md` with worker lease scheduler/background-runner testing guidance.
- Wave gate attempt 1: AC checks and build passed; CodeRabbit step failed before review because `wave-1-start-PROJ-7` was missing. Recreated the tag at `BASE_SHA`.

### Ralph Iteration 1
- Command: `npm run test:file --workspace=@beerengineer/engine -- test/workerLease.test.ts`
- Result: PASS (5 tests)
- AC-11: PASS — fresh/migrated run rows expose and persist `worker_instance_id`.
- AC-12: PASS — fresh/migrated run rows expose and persist `worker_owner_kind`.
- AC-13: PASS — lease claims persist deterministic `worker_started_at`.
- AC-14: PASS — lease claims and heartbeat refresh persist deterministic `worker_heartbeat_at`.
- AC-15: PASS — tests assert no workflow queue/job/reclaimer tables are introduced; source scan only found the assertion.

---

## Quality Gate — PROJ-7

### Code Review
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| P0 Critical | 0 | 0 | 0 |
| P1 High | 0 | 0 | 0 |
| P2 Medium | 0 | 0 | 0 |
| P3 Low | 0 | 0 | 0 |

### SonarCloud
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:---:|:--------:|
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

### Wave 1 Gate — PASSED (2026-05-06T16:47:50+02:00)
- [x] Ralph: 5 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 2

Status: in progress

- Prior gate verified: `### Wave 1 Gate — PASSED`
- Wave base tag: `wave-2-start-PROJ-7` at `9e8c4c9`

## PROJ-7-PRD-1-US-1: CLI durable worker ownership — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 CLI Start And Resume Lease Claim | ✓ | ✓ | ✓ |
| 2.2 CLI Heartbeat Loop | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | CLI workflow start records worker ownership before the workflow enters its first executable stage. | ✓ |
| AC-2 | CLI workflow resume records a new worker claim on the same run row before resumed workflow side effects proceed. | ✓ |
| AC-3 | CLI-owned runs record `worker_owner_kind = cli`. | ✓ |
| AC-4 | CLI-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work. | ✓ |
| AC-5 | A public CLI acceptance test verifies the documented CLI command changes run ownership and heartbeat state end to end. | ✓ |

## PROJ-7-PRD-1-US-2: API durable worker ownership — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.3 API Engine Instance And Start Claim | ✓ | ✓ | ✓ |
| 2.4 API Heartbeat Loop | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-6 | API-created workflow runs record worker ownership before the create/start endpoint returns an accepted response. | ✓ |
| AC-7 | API-created workflow runs record `worker_owner_kind = api`. | ✓ |
| AC-8 | API-created workflow runs record the current API engine instance id in `worker_instance_id`. | ✓ |
| AC-9 | API-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work. | ✓ |
| AC-10 | An API acceptance test verifies that a successful start response always corresponds to a run row with active worker ownership. | ✓ |

## PROJ-7-PRD-1-US-4: Heartbeat failure policy — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.5 Heartbeat Failure Policy | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-16 | A single heartbeat write failure is retried on the next 30-second cadence. | ✓ |
| AC-17 | A run remains active after one or two consecutive heartbeat write failures when the worker still owns the lease. | ✓ |
| AC-18 | After three consecutive heartbeat write failures, the worker marks its own run failed/recoverable if it can. | ✓ |
| AC-19 | If heartbeat refresh reports that ownership no longer belongs to the worker, the worker marks the run failed/recoverable and stops workflow execution if it can. | ✓ |
| AC-20 | Heartbeat failure behavior is covered for at least one CLI path and one API-owned path. | ✓ |

## PROJ-7-PRD-1-US-5: Production caller coverage — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.6 Production Caller Coverage Check | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-21 | Worker lease registration has a production caller in CLI workflow start. | ✓ |
| AC-22 | Worker lease registration has a production caller in CLI workflow resume. | ✓ |
| AC-23 | Worker lease registration has a production caller in API workflow start. | ✓ |
| AC-24 | Worker lease registration has a production caller in API workflow resume. | ✓ |
| AC-25 | Code review can identify production call sites for every new worker lease lifecycle primitive introduced by this PRD. | ✓ |

### Ralph Loop
- Iterations: 1

### TDD Notes
- RED: `npm run test:file --workspace=@beerengineer/engine -- test/workerLeaseCli.test.ts test/workerLeaseApi.test.ts test/workerLeaseHeartbeat.test.ts test/workerLeaseProductionCallers.test.ts` failed because start/resume claims and `startWorkerLeaseHeartbeat` are not implemented yet.
- GREEN: `npm run test:file --workspace=@beerengineer/engine -- test/workerLeaseCli.test.ts test/workerLeaseApi.test.ts test/workerLeaseHeartbeat.test.ts test/workerLeaseProductionCallers.test.ts` passed 7 tests.
- Public CLI acceptance: `npm run test:file --workspace=@beerengineer/engine -- test/cli-actions.test.ts` passed 5 tests.
- API regression: `npm run test:file --workspace=@beerengineer/engine -- test/apiIntegration.test.ts` passed 35 tests.
- Typecheck: `npm run typecheck` passed.

### Ralph Iteration 1
- Command: wave-2 targeted worker lease tests plus `cli-actions.test.ts`, `apiIntegration.test.ts`, and `npm run typecheck`
- Result: PASS
- AC-1..AC-5: PASS — CLI start/resume claims and heartbeat behavior are covered by `workerLeaseCli.test.ts`, `cli-actions.test.ts`, and production caller checks.
- AC-6..AC-10: PASS — API start ownership, API instance id, heartbeat refresh, and accepted-response ownership are covered by `workerLeaseApi.test.ts`.
- AC-16..AC-20: PASS — retry, third-failure recovery, lost-ownership recovery, and CLI/API owner coverage are covered by `workerLeaseHeartbeat.test.ts`.
- AC-21..AC-25: PASS — production caller coverage is enforced by `workerLeaseProductionCallers.test.ts`.

### Wave 2 Gate — PASSED (2026-05-06T17:08:45+02:00)
- [x] Ralph: 20 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only
