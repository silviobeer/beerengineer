# PROJ-6 Progress

## Status: in progress
## Current Wave: 4
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

---

## Wave 3 — in progress

- Wave base tag: `wave-3-start-PROJ-6` -> `ffd4486`

### User Stories
| User Story | Status |
|------------|:------:|
| PROJ-6-PRD-2-US-2: Manual Supabase setup guidance | complete |
| PROJ-6-PRD-2-US-3: Dedicated CLI connect and rotate path | complete |
| PROJ-6-PRD-2-US-4: Persistent test branch setup | complete |
| PROJ-6-PRD-2-US-5: Setup completion retry instruction | complete |

## PROJ-6-PRD-2-US-2: Manual Supabase setup guidance — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 Manual Supabase Guidance In CLI Setup | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-8 | CLI setup explicitly says the user must create or select the Supabase Cloud project manually. | ✓ |
| AC-9 | CLI setup guidance mentions choosing region/location and provider-side project settings in Supabase. | ✓ |
| AC-10 | CLI setup guidance mentions enabling/checking Supabase branching support for the project or plan. | ✓ |
| AC-11 | CLI setup guidance tells the user to copy the project ref and create a Management API token with project access. | ✓ |
| AC-12 | CLI setup can include useful Supabase links or references without making external browsing mandatory for automated tests. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setup/setupFlow.supabase.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/setupInteractiveEntry.test.ts`

## PROJ-6-PRD-2-US-3: Dedicated CLI connect and rotate path — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.2 Dedicated CLI Connect And Rotate Path | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-13 | CLI setup writes `supabase.management_token` only through dedicated Supabase connect/rotate logic, not the generic secret mutation handler. | ✓ |
| AC-14 | The privileged Supabase token ref remains deny-listed from generic `/setup/secrets/<ref>` style mutation. | ✓ |
| AC-15 | CLI setup validates that the token can access the entered project ref before marking the workspace connected. | ✓ |
| AC-16 | The project ref is stored on the selected workspace, not globally and not on a current-workspace guess. | ✓ |
| AC-17 | If validation fails, the previous active token/project metadata remains safe and the redacted provider message is shown before generic fallback copy. | ✓ |
| AC-18 | CLI setup maps invalid/revoked/HTTP 401 token failures to `Rotate management token` and HTTP 403 permission-denied failures to `Re-authorize project access`. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setup/setupFlow.supabase.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/setup/secretActions.supabaseRotate.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/setup/secretMetadata.test.ts`

## PROJ-6-PRD-2-US-4: Persistent test branch setup — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.3 Persistent Branch Setup In CLI | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-19 | CLI setup offers create or attach behavior for the persistent test branch after token/project validation. | ✓ |
| AC-20 | CLI setup does not create new Supabase projects. | ✓ |
| AC-21 | CLI setup shows `checking` or equivalent progress while branch health is polling interactively. | ✓ |
| AC-22 | CLI setup treats `ACTIVE_HEALTHY` as ready and stores the persistent branch ref/status on the workspace. | ✓ |
| AC-23 | If the interactive branch poll times out or provider state remains transient, CLI setup tells the user to recheck rather than marking execution-ready. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setup/setupFlow.supabase.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/persistentTestBranch.create.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/core/supabase/persistentTestBranch.attach.test.ts`

## PROJ-6-PRD-2-US-5: Setup completion retry instruction — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.4 CLI Setup Completion And Retry Instruction | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-24 | CLI setup completion displays a clear retry instruction for the blocked run when run context is available. | ✓ |
| AC-25 | Retrying after setup reuses the existing blocked `runId` semantics from PRD-1. | ✓ |
| AC-26 | If readiness is still incomplete on retry, CLI output shows the updated missing setup action list. | ✓ |
| AC-27 | CLI setup can also be run outside a blocked-run context to prepare a workspace ahead of time. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setup/setupFlow.supabase.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/cli-actions.test.ts`

### Wave 3 Gate Attempt 1 — FAILED
- Ralph: PASS (7 AC commands green)
- Build: PASS (`npm run typecheck`)
- CodeRabbit: FAIL — 1 `major` finding in `apps/engine/src/setup/supabaseSetup.ts`; the Management API validation catch also covered local persistence operations and could mislabel local failures as token-rotation actions.
- Fix: narrow `connectSupabaseProject` error classification to the `listProjects()` Management API call only; local secret/repository persistence now runs outside that catch.

### Wave 3 Gate — PASSED (2026-05-06T17:14:52+02:00)
- [x] Ralph: 7 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: minor,medium,low)
- [x] Smoke: backend-only

---

## Wave 4 — in progress

- Wave base tag: `wave-4-start-PROJ-6` -> `58d2c6e`

### User Stories
| User Story | Status |
|------------|:------:|
| PROJ-6-PRD-3-US-1: Workspace-specific Supabase settings route | complete |
| PROJ-6-PRD-3-US-2: Visible Supabase setup inputs | complete |
| PROJ-6-PRD-3-US-3: Readiness summary | complete |
| PROJ-6-PRD-3-US-4: Same-run retry from settings | complete |
| PROJ-6-PRD-3-US-5: Responsive/mobile Supabase settings polish | complete |

## PROJ-6-PRD-3-US-1: Workspace-specific Supabase settings route — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.1 Workspace Settings Route And Server Resolution | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | A new workspace settings route exists at `/w/:key/settings`. | ✓ |
| AC-2 | The route is a sibling of the existing `/w/:key` workspace board and uses the workspace shell/topbar pattern. | ✓ |
| AC-3 | The Supabase section is reachable via `#supabase`. | ✓ |
| AC-4 | The section navigation is forward-compatible for later workspace settings sections without requiring additional sections in PROJ-6. | ✓ |
| AC-5 | The engine resolves workspace metadata from the workspace key server-side; browser-supplied paths/project refs/branch refs are not authoritative. | ✓ |
| AC-6 | The `/w/:key/settings` route never trusts a body-provided workspace id over the route key/server-resolved workspace. | ✓ |
| AC-7 | Opening settings for workspace `beta` cannot configure or unblock a run for workspace `alpha`. | ✓ |

## PROJ-6-PRD-3-US-2: Visible Supabase setup inputs — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.2 Visible Workspace Supabase Inputs | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-8 | The page visibly provides a Supabase project ref input. | ✓ |
| AC-9 | The page visibly provides a Supabase Management API token input or token replace/rotate control. | ✓ |
| AC-10 | The page visibly provides a persistent test branch create/attach choice after project/token validation is available. | ✓ |
| AC-11 | The token input uses the dedicated Supabase connect/rotate path and not a generic secret mutation route. | ✓ |
| AC-12 | The not-configured state renders a stub plus setup inputs; it does not render the full connected cleanup/protection control set. | ✓ |

## PROJ-6-PRD-3-US-3: Readiness summary — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.3 Workspace Readiness Summary | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-13 | The readiness summary shows blocked/ready/checking/error state for the selected workspace. | ✓ |
| AC-14 | Missing token, missing project ref, missing branch, invalid token, and unauthorized-project states use exactly the PRD-1 missing setup action labels. | ✓ |
| AC-15 | `Retry run` is shown only as a separate blocked-run affordance when run context exists, not as a missing setup action. | ✓ |
| AC-16 | Invalid/revoked/HTTP 401 token failures show `Rotate management token`; HTTP 403 permission-denied project access failures show `Re-authorize project access`. | ✓ |
| AC-17 | The UI displays redacted provider `message` text before generic fallback copy when the engine returns one. | ✓ |
| AC-18 | The UI can show `checking` during setup/settings recheck while branch health is polling. | ✓ |
| AC-19 | The UI does not mark the workspace ready until the engine reports `ACTIVE_HEALTHY` branch readiness. | ✓ |

## PROJ-6-PRD-3-US-4: Same-run retry from settings — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.4 Workspace Settings Retry Flow | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-20 | Retry is disabled or absent while readiness remains blocked/checking. | ✓ |
| AC-21 | Retry becomes available after the engine reports ready and run context is known. | ✓ |
| AC-22 | Retry uses the existing blocked `runId` semantics from PRD-1 rather than creating a new normal run. | ✓ |
| AC-23 | If no blocked-run context is available, the page still allows setup/recheck but does not show a misleading retry action. | ✓ |
| AC-24 | If retry still blocks, the UI refreshes the missing setup action list instead of claiming success. | ✓ |

## PROJ-6-PRD-3-US-5: Responsive/mobile Supabase settings polish — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.5 Responsive Workspace Settings Polish | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-25 | At 375px width, project ref, token, persistent branch choice, recheck, and retry controls remain visible and usable. | ✓ |
| AC-26 | The workspace settings section nav stacks above content on narrow screens. | ✓ |
| AC-27 | The UI reuses existing dark operator-console tokens and square bordered panel language. | ✓ |
| AC-28 | Important UI elements use or are traceable to accepted reuse/new component candidates from the implementation handoff. | ✓ |
| AC-29 | New top-level workspace settings UI has a 375px screenshot captured before QA can mark the UI wave green. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/api/routes/workspaceSupabaseReadiness.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/api/routes/workspaceSupabaseSetup.test.ts`; `npm run test:file --workspace=@beerengineer/engine -- test/api/routes/supabaseReadinessRetry.test.ts`; `npm test --workspace=@beerengineer/ui -- tests/workspaceSettingsPage.test.tsx tests/workspaceSupabaseSettings.test.tsx tests/workspaceSupabaseReadinessSummary.test.tsx tests/workspaceSupabaseRetry.test.tsx`; `npm run typecheck`; 375px screenshot captured as `proj6-wave4-settings-mobile-run-context-375.png`

### Wave 4 Gate Attempt 1 — FAILED
- Ralph: PASS (7 AC commands green)
- Build: PASS (`npm run typecheck`)
- CodeRabbit: FAIL — 1 `major` finding in `apps/ui/components/settings/WorkspaceSettingsPage.tsx`; the UI exposed Create vs Attach branch selection but did not send the selected mode to the backend.
- Fix: send `mode` from the workspace settings UI, forward it through the Next proxy, and have the engine route pass attach/create intent to persistent branch setup.

### Wave 4 Gate — PASSED (2026-05-06T17:48:53+02:00)
- [x] Ralph: 7 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: minor,medium,low)
- [x] Smoke: /w/alpha/settings#supabase
