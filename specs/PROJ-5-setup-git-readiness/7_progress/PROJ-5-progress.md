# PROJ-5 Progress

## Status: QA passed
## Current Wave: Documentation
## BASE_SHA: a9b9cc683e6c7b3be1a3e724442634daaaa5e018

---

## Preflight

- CodeRabbit config: PASS (`.coderabbit.yaml` present, chill profile, focused path filters).
- Required CLIs: PASS (`jq`, `coderabbit`, `agent-browser` found).
- Playwright MCP: PASS (browser MCP tools available).
- Supabase MCP: WAIVED by user for PROJ-5 after preflight stop; PROJ-5 does not touch Supabase and user directed execution to use `agent-browser`.

---

## Wave 1

### Wave Start
- Tag: `wave-1-start-PROJ-5`
- Started from: `a9b9cc683e6c7b3be1a3e724442634daaaa5e018`

## PROJ-5-PRD-1-US-1: Als Developer auf einer frischen Maschine moechte ich Git-Identity-Readiness als Status sehen um fehlende Git-Konfiguration vor einem Workflow zu erkennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Canonical Global Readiness Snapshot | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Der globale Readiness-Modus meldet Git-Installation, globale `user.name`, globale `user.email`, App-Level-Default-Name, App-Level-Default-Email und verfuegbare globale Aktionen. | ✓ |
| AC-2 | Wenn Git installiert ist, aber keine globale und keine App-Level-Identitaet existiert, ist Setup nicht kaputt, aber Workflow-Readiness ist blockiert. | ✓ |
| AC-3 | Der globale Status unterscheidet fehlendes Git von fehlender Git-Identitaet. | ✓ |
| AC-4 | Der Status enthaelt keine rohen Secrets oder Tokens. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-4 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts test/appConfigView.test.ts test/setupStatus.test.ts test/gitIdentityValidation.test.ts test/gitIdentityConfig.test.ts test/gitIdentityReadiness.test.ts test/gitIdentityRepair.test.ts test/gitIdentityApi.test.ts`

---

## PROJ-5-PRD-1-US-2: Als Existing Repo User moechte ich sehen, welche Identitaet ein Workspace verwenden wuerde um bestehende Repo-Konfiguration nicht zu ueberschreiben — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.2 Workspace Readiness Precedence | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Workspace-Readiness meldet, ob der registrierte Workspace ein Git-Repo ist. | ✓ |
| AC-6 | Repo-local `user.name` und `user.email` gewinnen vor globaler und App-Level-Identitaet. | ✓ |
| AC-7 | Wenn repo-local fehlt, aber globale Identitaet vollstaendig ist, ist der Workspace ready. | ✓ |
| AC-8 | Wenn repo-local und global fehlen, aber App-Level-Default existiert, meldet der Status eine anwendbare Workspace-Repair-Aktion statt sofortiger Ready-State. | ✓ |
| AC-9 | Wenn alle Identitaetsquellen fehlen, meldet der Status einen Workflow-Blocker mit Reparaturhinweis. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-5..AC-9 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts test/appConfigView.test.ts test/setupStatus.test.ts test/gitIdentityValidation.test.ts test/gitIdentityConfig.test.ts test/gitIdentityReadiness.test.ts test/gitIdentityRepair.test.ts test/gitIdentityApi.test.ts`

---

## PROJ-5-PRD-1-US-3: Als Operator moechte ich eine beerengineer_-Default-Identitaet speichern um neue verwaltete Workspaces ohne globale Git-Konfiguration nutzen zu koennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.3 App-Level Identity Config | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-10 | Die App-Level-Identitaet enthaelt Display Name, Email und `localOnly`. | ✓ |
| AC-11 | Das Speichern der App-Level-Identitaet schreibt keine Werte nach `git config --global`. | ✓ |
| AC-12 | Eine gespeicherte App-Level-Identitaet erscheint im globalen Setup-Status. | ✓ |
| AC-13 | Private Placeholder-Emails setzen `localOnly: true`. | ✓ |
| AC-14 | Realistische oder GitHub-noreply-Emails koennen `localOnly: false` sein. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-10..AC-14 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts test/appConfigView.test.ts test/setupStatus.test.ts test/gitIdentityValidation.test.ts test/gitIdentityConfig.test.ts test/gitIdentityReadiness.test.ts test/gitIdentityRepair.test.ts test/gitIdentityApi.test.ts`

---

## PROJ-5-PRD-1-US-4: Als CLI/API Consumer moechte ich eine gemeinsame Email-Validierung nutzen um Setup-Ergebnisse in CLI und UI konsistent zu halten — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.4 Shared Identity Validator And Error Vocabulary | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-15 | CLI, API und UI verwenden dieselbe Validierungslogik oder denselben serverseitigen Validator. | ✓ |
| AC-16 | Der Validator akzeptiert strukturell gueltige `local@domain` Formen. | ✓ |
| AC-17 | Der Validator erkennt `@local.beerengineer` als privaten lokalen Placeholder. | ✓ |
| AC-18 | Der Validator erkennt GitHub-noreply-Formen als publishing-taugliche Option. | ✓ |
| AC-19 | Ungueltige Eingaben liefern feldspezifische Fehlermeldungen fuer Display Name oder Email. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-15..AC-19 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts test/appConfigView.test.ts test/setupStatus.test.ts test/gitIdentityValidation.test.ts test/gitIdentityConfig.test.ts test/gitIdentityReadiness.test.ts test/gitIdentityRepair.test.ts test/gitIdentityApi.test.ts`

---

## PROJ-5-PRD-1-US-5: Als Security-conscious Operator moechte ich Workspace-Reparaturen nur gegen registrierte Server-State-Pfade ausfuehren um Path-Injection zu verhindern — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.5 Workspace Repair API | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-20 | Workspace-Reparatur nimmt eine Workspace-ID oder einen Workspace-Key entgegen, aber keinen vertrauenswuerdigen Root-Pfad. | ✓ |
| AC-21 | Der Engine-Code loest den Workspace-Root serverseitig aus der Workspace-Registry auf. | ✓ |
| AC-22 | Request-Body-Felder wie `path`, `rootPath` oder `workspaceRoot` werden bei Reparaturaktionen ignoriert oder abgelehnt. | ✓ |
| AC-23 | Ein unbekannter Workspace fuehrt zu einem klaren `workspace_not_found` Fehler ohne Git-Nebenwirkungen. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-20..AC-23 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts test/appConfigView.test.ts test/setupStatus.test.ts test/gitIdentityValidation.test.ts test/gitIdentityConfig.test.ts test/gitIdentityReadiness.test.ts test/gitIdentityRepair.test.ts test/gitIdentityApi.test.ts`

---

## Quality Gate — PROJ-5

### Code Review
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| P0 Critical | 0 | 0 | 0 |
| P1 High | 1 | 1 | 0 |
| P2 Medium | 0 | 0 | 0 |
| P3 Low | 5 | 5 | 0 |

### SonarCloud
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| Critical/Major | 11 | 11 | 0 |
| Minor | 4 | 4 | 0 |
| Info | 0 | 0 | 0 |

### Fixed Issues
- CodeRabbit P1: docs setup endpoint index and item-action contract drift fixed in `docs/AGENTS.md` and `docs/api-contract.md`.
- CodeRabbit P3: UI setup Git proxy malformed JSON handling now returns `400 Malformed JSON`.
- CodeRabbit P3: app config env override now rejects partial Git identity defaults instead of silently mixing sources.
- CodeRabbit P3: duplicate Wave 4 progress gate entry removed.
- Sonar Critical/Major: setup Git route, setup flow, Git identity helpers, and workflow repair UI complexity/nesting findings refactored.
- Sonar Minor: regex, unused import, negated condition, and empty-object cleanup findings fixed.

### Deferred (user decision)
- Repo-level SonarCloud gate remains `ERROR` from existing unrelated project issues; final PROJ-5 changed-file filter reports 0 unresolved issues.

---

## QA Results

- Tested: 2026-05-06; rerun after PROJ-5 QA fixes on 2026-05-06.
- Automated evidence: `npm run typecheck --workspace=@beerengineer/engine`, `npm run typecheck --workspace=@beerengineer/ui`, focused engine test-file run (68 passed), focused UI test run (13 passed).
- Browser evidence: `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-rerun-rootless-setup-recheck-stale.png`, `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-rerun-workflow-repair-ready.png`, `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-rerun-workflow-repair-mobile-375.png`.
- Acceptance criteria: 85 total; 84 passed or covered by green targeted tests, 1 failed in browser QA.
- Bugs found: 6 total (Critical: 1 fixed, High: 3 with 1 open, Medium: 2 fixed, Low: 0).
- Security findings: 0 direct security vulnerabilities found. CSRF rejected unauthenticated mutations in automated coverage; browser storage did not expose the API token; path injection coverage passed for readiness/repair/start paths.
- Production ready: YES.
- QA rerun evidence for BUG-PROJ5-QA-006: `specs/PROJ-5-setup-git-readiness/8_qa/proj5-docgate-rootless-recheck-fixed.png`; browser network showed `GET /api/setup/git-readiness` without `workspaceId` and the Git card updated to `ok`.

### QA Bugs

### BUG-PROJ5-QA-001 — [Critical] PROJ-5 UI components are missing from the shared component registry
- **File:** `docs/components.md`
- **Anchor:** `## New Component Candidates From PROJ-4`
- **Source:** Marcus Weber (Principal Engineer) + UI registry hard check
- **Status:** verified fixed in QA rerun
- **Fix attempts:** 1
- **Description:** `apps/ui/components/WorkflowGitRepairPanel.tsx`, `apps/ui/components/setup/GitIdentityForm.tsx`, and `apps/ui/components/setup/GitIdentityPanel.tsx` were added after `BASE_SHA`, but `docs/components.md` has no PROJ-5 entries for them. The QA skill classifies a missing registry entry for new shared components as Critical because future UI work cannot reliably discover or reuse them.
- **Repro:** `git diff --name-status a9b9cc683e6c7b3be1a3e724442634daaaa5e018..HEAD -- apps/ui/components docs/components.md`, then search `docs/components.md` for `WorkflowGitRepairPanel`, `GitIdentityForm`, and `GitIdentityPanel`.
- **Fix sketch:** Add a PROJ-5 component-candidate section documenting these components, their ownership, and which existing primitives they compose.
- **Fix:** Added the PROJ-5 component-candidate section to `docs/components.md` for `GitIdentityForm`, `GitIdentityPanel`, and `WorkflowGitRepairPanel`.

### BUG-PROJ5-QA-002 — [High] Prepared-import starts bypass the workflow Git readiness gate
- **File:** `apps/engine/src/core/runService.ts`
- **Anchor:** `export async function startPreparedImportForItem`
- **Source:** Browser E2E + Thomas Müller (SRE/Reliability) + Dr. Sarah Chen (Security)
- **Status:** verified fixed in QA rerun
- **Fix attempts:** 1
- **Description:** With no repo-local or global Git identity, the browser `Import prepared` action returned `200 OK`, moved the item to `implementation/running`, created a blocked run row, wrote `.beerengineer/workspaces/...` directories, and emitted run logs. This violates PRD-4 AC-1 and AC-2 because workflow-start side effects occurred before the Git identity gate.
- **Repro:** In an isolated workspace with app-level identity only, unset local `user.name`/`user.email`, open `/w/proj5qa`, click `Import prepared`, provide a prepared artifact directory, and inspect the item/run rows.
- **Evidence:** `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-item-detail-actions-disabled.png` plus DB evidence captured during QA: run `d9895eab-7a31-468f-944e-f1547039fa82` was created with status `blocked`.
- **Fix sketch:** Apply `checkWorkflowStartGitReadiness` before `loadPreparedImportBundleWithLlmFallback`, `prepareRun`, item column changes, and artifact seeding in `startPreparedImportForItem`.
- **Fix:** `startPreparedImportForItem` now runs the workflow Git gate before bundle load, run preparation, item movement, and artifact seeding, and returns the shared `workflow_git_blocked` shape.

### BUG-PROJ5-QA-003 — [High] Full item detail cannot trigger the workflow Git repair panel
- **File:** `apps/engine/src/api/routes/items.ts`
- **Anchor:** `export function handleGetItem`
- **Source:** Browser E2E + Marcus Weber (Principal Engineer)
- **Status:** verified fixed in QA rerun
- **Fix attempts:** 1
- **Description:** The full item detail page renders all toolbar actions disabled because `GET /items/:id` returns the raw item row without `allowedActions`; `apps/ui/lib/engine/server.ts` therefore normalizes `allowedActions` to an empty array. The PRD-4 contextual repair panel cannot be reached from the full detail start controls.
- **Repro:** Navigate to `/w/proj5qa/items/<idea-item-id>` for an idea/draft item. `Start Brainstorm`, `Import Prepared`, and all other toolbar buttons are disabled even though the engine transition matrix permits `start_brainstorm` and `import_prepared`.
- **Evidence:** `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-item-detail-actions-disabled.png`.
- **Fix sketch:** Return allowed item actions from the engine detail endpoint or compute the same action availability in the UI from the item state before rendering disabled controls.
- **Fix:** `GET /items/:id` now includes `allowedActions` from the engine transition matrix so item-detail toolbar controls can reach the workflow repair panel.

### BUG-PROJ5-QA-004 — [Medium] UI engine URL environment variables are inconsistent across setup and workflow surfaces
- **File:** `apps/ui/lib/engine/server.ts`
- **Anchor:** `function engineBaseUrl()`
- **Source:** Browser E2E + Elena Rodriguez (Principal Architect)
- **Status:** verified fixed in QA rerun
- **Fix attempts:** 1
- **Description:** Setup server helpers honor `BEERENGINEER_ENGINE_URL`, but the board/item engine helpers only honor `ENGINE_URL` or `NEXT_PUBLIC_ENGINE_URL`. With a non-default engine port, `/setup` works while `/w/:key` talks to the default `localhost:4100`, causing false `Workspace not found` / workspace-loading failures.
- **Repro:** Start the UI with `BEERENGINEER_ENGINE_URL=http://127.0.0.1:4211` but without `ENGINE_URL`; `/setup` reads the QA engine, while `/w/proj5qa` fails until `ENGINE_URL` is also set.
- **Fix sketch:** Centralize UI engine URL resolution and support the same env precedence in setup, board, item-detail, and proxy helpers.
- **Fix:** Added `apps/ui/lib/engine/baseUrl.ts` and routed setup, board, item-detail, API, proxy, and Next config through the same precedence: `BEERENGINEER_ENGINE_URL`, `ENGINE_URL`, `NEXT_PUBLIC_ENGINE_URL`, default.

### BUG-PROJ5-QA-005 — [Medium] Setup Git card renders a generic 404 for an active workspace row without a root path
- **File:** `apps/ui/app/setup/page.tsx`
- **Anchor:** `fetchGitReadiness(config.data?.workspace?.id)`
- **Source:** Browser E2E + Thomas Müller (SRE/Reliability)
- **Status:** partially fixed; server initial render verified, client recheck gap tracked as BUG-PROJ5-QA-006
- **Fix attempts:** 1
- **Description:** When the dev seed creates a workspace row without `rootPath`, `/setup` passes that workspace ID into Git readiness and renders `engine responded 404` instead of global readiness or a clear workspace-path stub. The topbar simultaneously says `no workspaces`, which makes the page contradictory.
- **Repro:** Start a fresh dev DB with `BEERENGINEER_SEED=1` and open `/setup`.
- **Evidence:** `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-setup-seeded-workspace-404.png`.
- **Fix sketch:** Treat config workspace rows without a usable root as "no selected workspace" for setup Git readiness, or render the shared not-configured workspace stub instead of a transport error.
- **Fix:** `/setup` now resolves the configured workspace through the engine first and only passes a workspace ID to Git readiness when that workspace has a usable root path.

### BUG-PROJ5-QA-006 — [High] Setup app-identity save leaves rootless-workspace UI stale and blocked
- **File:** `apps/ui/components/setup/GitIdentityPanel.tsx`
- **Anchor:** `async function recheck`
- **Source:** Browser E2E rerun + Thomas Müller (SRE/Reliability)
- **Status:** verified fixed
- **Fix attempts:** 1
- **Description:** With the current workspace row present but `rootPath: null`, the initial `/setup` server render correctly falls back to global Git readiness. After saving a beerengineer_ app-level identity in the browser, `GitIdentityPanel.recheck()` sends `?workspaceId=<rootless-workspace-id>` to `/api/setup/git-readiness`. The engine returns `404 workspace_not_found`, so the UI keeps showing `Blocked`, `Not configured`, and `Git readiness could not be refreshed` even though the identity was saved and a full page reload shows `ok`.
- **Repro:** Seed a current workspace row with no root path, open `/setup`, save `QA Browser User <qa-browser@local.beerengineer>`, and observe the stale blocked Git card. Engine `GET /setup/git-readiness` returns the saved app default immediately; only the client recheck path is wrong.
- **Evidence:** `specs/PROJ-5-setup-git-readiness/8_qa/proj5-qa-rerun-rootless-setup-recheck-stale.png`; Next dev log showed `GET /api/setup/git-readiness?workspaceId=<rootless-id> 404`.
- **Fix sketch:** Make the client recheck use the same usable-root fallback rule as `resolveSetupGitReadinessWorkspaceId`, or omit `workspaceId` when the setup workspace has no usable root.
- **Fix:** `GitIdentityPanel.recheck()` now appends `workspaceId` only when the current readiness model is workspace-mode. Added a regression test for saving app identity while setup has a rootless current workspace.
- **QA verification:** Browser rerun confirmed app-identity save refreshed global readiness without `workspaceId`; Git card updated to `ok` in-place.

### Persona Review Summary
- Dr. Sarah Chen — Security Lead: 0 new findings in rerun; prior prepared-import bypass verified fixed.
- Marcus Weber — Principal Engineer: 0 new findings in rerun; component registry and item-detail action contract verified fixed.
- Priya Sharma — Performance Engineer: 0 findings.
- Thomas Müller — SRE/Reliability Engineer: 1 High rerun finding (rootless setup client recheck stale after save).
- Elena Rodriguez — Principal Architect: 0 new findings in rerun; prior split engine URL resolver verified fixed.
- Ken Takahashi — Minimalism Engineer: 0 blocking findings.

## AGENTS.md Candidates
- [PROPOSED] AGENTS-PROJ5-QA-001: Gate every start-run path before run rows, item moves, worktrees, or artifacts. — source: BUG-PROJ5-QA-002
- [PROPOSED] AGENTS-PROJ5-QA-002: UI engine clients must share one engine URL resolver and env precedence. — source: BUG-PROJ5-QA-004
- [PROPOSED] AGENTS-PROJ5-QA-003: Register new shared UI components in docs/components.md before QA. — source: BUG-PROJ5-QA-001
- [PROPOSED] AGENTS-PROJ5-QA-004: Client refresh paths must preserve fallback rules used by initial server renders. — source: BUG-PROJ5-QA-006

## PROJ Retrospective

### Elena Rodriguez (Principal Architect)
- PROJ-5 correctly centralized Git identity semantics in the engine; the shared readiness model held up under direct API/security tests.
- The assembled feature exposed a second integration axis: UI server helpers are not yet centralized, so setup and board surfaces can disagree about the engine base URL.
- The workflow gate was implemented for normal item actions, but prepared import lived on a neighboring path and escaped the cross-cutting invariant. Future architecture docs should name all "start-run" entry points, not only the obvious action names.
- The setup UI successfully preserves the nontechnical local-checkpoint story, including the no-GitHub/no-push message.
- The feature is close structurally, but release readiness depends on making the gate invariant impossible to bypass.
- Component registry drift suggests the design-system governance step needs to run as part of implementation, not only QA.

### Ken Takahashi (Minimalism)
- The concept stayed small: no GitHub, no pushing, no global Git writes. That restraint paid off.
- The code now has multiple engine URL resolvers in the UI; this is accidental complexity and should collapse to one helper.
- Prepared import should reuse the same start-run preflight helper instead of having a parallel orchestration path.
- The item-detail action model should either consume engine-provided allowed actions everywhere or derive them consistently in one UI helper, not half of each.
- Avoid adding another setup-specific error display for rootless workspaces; route that through the same readiness/stub vocabulary already built for Git.

---

## Open Blockers
- —

### Wave 1 Gate — PASSED (2026-05-06T11:23:37+02:00)
- [x] Ralph: 23 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 2

### Wave Start
- Tag: `wave-2-start-PROJ-5`
- Started from: `ac21c2b7de8331f440cb584ff29205323af8812e`

## PROJ-5-PRD-2-US-1: Als nontechnical User moechte ich mit `beerengineer setup` direkt in die Setup-UI gelangen um ohne Terminalwissen starten zu koennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Interactive Setup Launch Or Reuse | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Interaktives `beerengineer setup` initialisiert fehlende App-Config und DB wie bisher. | ✓ |
| AC-2 | Interaktives `beerengineer setup` startet oder verwendet eine laufende Engine. | ✓ |
| AC-3 | Interaktives `beerengineer setup` startet oder verwendet eine laufende UI. | ✓ |
| AC-4 | Die geoeffnete URL wird aus Runtime/Config ermittelt und nicht hartcodiert. | ✓ |
| AC-5 | Erfolgreicher Browser-Open wird mit der verwendeten URL gemeldet. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-5 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupInteractiveEntry.test.ts test/nonInteractivePrompt.test.ts test/setupStatus.test.ts test/setupCliGitIdentity.test.ts && npm run typecheck --workspace=@beerengineer/engine`

## PROJ-5-PRD-2-US-2: Als Developer in SSH, CI oder Container moechte ich Setup ohne Browser-Fehler nutzen um die echte Setup-URL manuell oeffnen zu koennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.2 Headless Setup Degradation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-6 | Headless-, CI-, SSH-, Container- oder No-Opener-Situationen degradieren zu "URL drucken". | ✓ |
| AC-7 | Die gedruckte URL ist die tatsaechlich entdeckte URL inklusive Host und Port. | ✓ |
| AC-8 | Engine und UI bleiben verfuegbar, wenn sie erfolgreich gestartet oder gefunden wurden. | ✓ |
| AC-9 | Browser-Open-Fehler wird als recoverable Setup-Hinweis gemeldet, nicht als harter Core-Fehler. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-6..AC-9 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupInteractiveEntry.test.ts test/nonInteractivePrompt.test.ts test/setupStatus.test.ts test/setupCliGitIdentity.test.ts && npm run typecheck --workspace=@beerengineer/engine`

## PROJ-5-PRD-2-US-3: Als Automation oder Install-Validator moechte ich `setup --no-interactive` ohne UI-Start verwenden um reproduzierbare Checks zu erhalten — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.3 Non-Interactive Setup Readiness Output | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-10 | `setup --no-interactive` versucht keinen Browser-Open. | ✓ |
| AC-11 | `setup --no-interactive` startet keine interaktive Eingabe fuer Git-Identitaet. | ✓ |
| AC-12 | `setup --no-interactive` kann fehlende Git-Identitaet als actionable readiness melden. | ✓ |
| AC-13 | `setup --no-interactive` bleibt fuer bestehende Install- und Doctor-Tests deterministisch. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-10..AC-13 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupInteractiveEntry.test.ts test/nonInteractivePrompt.test.ts test/setupStatus.test.ts test/setupCliGitIdentity.test.ts && npm run typecheck --workspace=@beerengineer/engine`

## PROJ-5-PRD-2-US-4: Als CLI User moechte ich App-Level-Git-Identitaet im Terminal speichern koennen um den Engine-first Setup-Pfad vollstaendig zu nutzen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.4 CLI App Identity Prompt | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Interaktives CLI-Setup bietet eine Eingabe fuer App-Level-Default-Name und Email. | ✓ |
| AC-15 | CLI-Validierungsfehler sind feldspezifisch und erklaeren die Korrektur. | ✓ |
| AC-16 | Eine gespeicherte CLI-Identitaet erscheint danach im Setup-Readiness-Status. | ✓ |
| AC-17 | CLI-Setup schreibt keine globale Git-Konfiguration. | ✓ |
| AC-18 | CLI-Setup kann aus globaler Git-Identitaet vorbefuellen und trotzdem Edit/Skip erlauben. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-14..AC-18 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupInteractiveEntry.test.ts test/nonInteractivePrompt.test.ts test/setupStatus.test.ts test/setupCliGitIdentity.test.ts && npm run typecheck --workspace=@beerengineer/engine`

### Wave 2 Gate — PASSED (2026-05-06T11:53:15+02:00)
- [x] Ralph: 18 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 3

### Wave Start
- Tag: `wave-3-start-PROJ-5`
- Started from: `b15417d8f55cbff1f82249e8938d4ac1ca124b92`

## PROJ-5-PRD-3-US-1: Als nontechnical User moechte ich im Setup-Wizard eine verstaendliche Git-Stufe sehen um lokale Commit-Checkpoints einordnen zu koennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 Setup Git Step Shell | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Die Git-Stufe bleibt Teil des bestehenden `/setup` Wizards. | ✓ |
| AC-2 | Die Git-Stufe verwendet die bestehende `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox` und `StatusChip` Patterns. | ✓ |
| AC-3 | Die Git-Erklaerung unterscheidet lokale Commit-Checkpoints von GitHub-Publishing. | ✓ |
| AC-4 | Die Git-Stufe fuehrt keine GitHub-Remote-, Push- oder PR-Aktion ein. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-4 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupGitReadiness.test.tsx tests/setupGitIdentityForm.test.tsx tests/setupGitWorkspaceRepair.test.tsx tests/setupGitMissingStub.test.tsx tests/setupRecheckFlow.test.tsx tests/mobile-375.test.tsx && npm run typecheck --workspace=@beerengineer/ui`

## PROJ-5-PRD-3-US-2: Als Setup User moechte ich die verwendete Git-Identitaetsquelle sehen um zu verstehen, ob Workspace, globale Config oder beerengineer_ Default greift — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.2 Setup Readiness API Proxy And Source Rows | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Ohne ausgewaehlten Workspace rendert die UI globale Git-Readiness. | ✓ |
| AC-6 | Mit ausgewaehltem registrierten Workspace rendert die UI Workspace-Readiness. | ✓ |
| AC-7 | Die UI zeigt die effektive Identitaetsquelle, die ein Workflow verwenden wuerde. | ✓ |
| AC-8 | Repo-local Identitaet wird als respektiert/authoritative angezeigt. | ✓ |
| AC-9 | Globale Git-Identitaet wird als ready angezeigt, wenn repo-local fehlt. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-5..AC-9 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupGitReadiness.test.tsx tests/setupGitIdentityForm.test.tsx tests/setupGitWorkspaceRepair.test.tsx tests/setupGitMissingStub.test.tsx tests/setupRecheckFlow.test.tsx tests/mobile-375.test.tsx && npm run typecheck --workspace=@beerengineer/ui`

## PROJ-5-PRD-3-US-3: Als User ohne Git-Identitaet moechte ich eine beerengineer_-Default-Identitaet speichern um spaetere Workspaces einfacher zu starten — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.3 App Identity Form | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-10 | Die UI bietet ein Formular fuer Display Name und Email. | ✓ |
| AC-11 | Das Formular erklaert, dass die Identitaet in beerengineer_ Config gespeichert wird, nicht in global Git config. | ✓ |
| AC-12 | GitHub-noreply, realistische Emails und private Placeholder werden gemaess gemeinsamem Validator behandelt. | ✓ |
| AC-13 | Private Placeholder zeigen einen lokalen/publishing Vorsichtshinweis. | ✓ |
| AC-14 | Nach erfolgreichem Speichern rechecked die UI Readiness aus einer frischen Engine-Antwort. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-10..AC-14 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupGitReadiness.test.tsx tests/setupGitIdentityForm.test.tsx tests/setupGitWorkspaceRepair.test.tsx tests/setupGitMissingStub.test.tsx tests/setupRecheckFlow.test.tsx tests/mobile-375.test.tsx && npm run typecheck --workspace=@beerengineer/ui`

## PROJ-5-PRD-3-US-4: Als Existing Repo User moechte ich fehlende Workspace-Identitaet aus der Setup-UI reparieren um den naechsten Workflow ohne Terminalkommandos starten zu koennen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.4 Setup Workspace Repair Controls | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-15 | Workspace-Repair schreibt Identitaet nur nach user confirmation. | ✓ |
| AC-16 | Die UI sendet nur Workspace-ID/Key und Identitaetsdaten, keinen vertrauenswuerdigen Workspace-Pfad. | ✓ |
| AC-17 | Nach Repair ruft die UI Readiness neu ab. | ✓ |
| AC-18 | Wenn nur Name oder Email geschrieben wurde, zeigt die UI die partielle frische State und passende Fehlerhinweise. | ✓ |
| AC-19 | Bestehende repo-local Identitaet wird nicht durch die Default-Repair-Aktion ueberschrieben. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-15..AC-19 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupGitReadiness.test.tsx tests/setupGitIdentityForm.test.tsx tests/setupGitWorkspaceRepair.test.tsx tests/setupGitMissingStub.test.tsx tests/setupRecheckFlow.test.tsx tests/mobile-375.test.tsx && npm run typecheck --workspace=@beerengineer/ui`

## PROJ-5-PRD-3-US-5: Als User ohne Git-Installation moechte ich Installationshinweise statt eines falschen Formulars sehen um die richtige Voraussetzung zu reparieren — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.5 Missing Git Stub State | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-20 | Missing Git rendert eine Stub-Ansicht statt des vollen Identity-Forms. | ✓ |
| AC-21 | Die Stub-Ansicht enthaelt Installationshinweis und Recheck-Aktion. | ✓ |
| AC-22 | Die UI bietet keine Identity-Repair-Aktion an, solange Git fehlt. | ✓ |
| AC-23 | Nach erfolgreichem Recheck mit installiertem Git wechselt die UI in die passende Readiness-Ansicht. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-20..AC-23 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupGitReadiness.test.tsx tests/setupGitIdentityForm.test.tsx tests/setupGitWorkspaceRepair.test.tsx tests/setupGitMissingStub.test.tsx tests/setupRecheckFlow.test.tsx tests/mobile-375.test.tsx && npm run typecheck --workspace=@beerengineer/ui`

### Wave 3 Gate — PASSED (2026-05-06T12:07:03+02:00)
- [x] Ralph: 23 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: /setup

---

## Wave 4

### Wave Start
- Tag: `wave-4-start-PROJ-5`
- Started from: `94c15ac067c33713060911a56a5415262010bd1c`

## PROJ-5-PRD-4-US-1: Als Workspace User moechte ich vor Workflow-Start auf fehlende Git-Identitaet gestoppt werden um keine halb gestarteten Runs oder Git-Fehler zu erzeugen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.1 Workflow Start Readiness Gate | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Workflow-Start prueft Workspace-Git-Readiness vor Branch-, Worktree- oder LLM-Ausfuehrung. | ✓ |
| AC-2 | Fehlende Git-Identitaet blockiert den Start vor Ausfuehrungsnebenwirkungen. | ✓ |
| AC-3 | Der Blocker nennt Git-Identitaet als Ursache und verweist auf Reparatur. | ✓ |
| AC-4 | Missing Git wird als Voraussetzung/Setup-Blocker getrennt von Missing Identity dargestellt. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-4 pass 1: FAIL — `npm run test:file --workspace=@beerengineer/engine -- test/workflowGitGate.test.ts` shows workflow starts still proceed to `prepareRun`, creating runs and background DB work instead of returning Git readiness blockers.
- AC-1..AC-4 pass 2: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/workflowGitGate.test.ts`

## PROJ-5-PRD-4-US-2: Als Security-conscious Operator moechte ich, dass Workflow-Start den Workspace serverseitig aufloest um keine Pfadangriffe ueber Start-Payloads zuzulassen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.2 Server-Side Start Workspace Resolution | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Workflow-Start prueft Readiness gegen den serverseitig aufgeloesten Workspace des Items oder Requests. | ✓ |
| AC-6 | Der Start-Request akzeptiert keinen vertrauenswuerdigen `workspaceRoot` fuer Git-Readiness. | ✓ |
| AC-7 | Ein unbekannter oder geloeschter Workspace blockiert mit klarer Fehlermeldung vor Git-Nebenwirkungen. | ✓ |
| AC-8 | Tests decken manipulierte Pfadfelder im Start-Payload ab. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-5..AC-8 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/workflowGitGate.test.ts`

## PROJ-5-PRD-4-US-3: Als nontechnical User moechte ich fehlende Identitaet direkt aus dem blockierten Start reparieren um nicht meinen Start-Kontext zu verlieren — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.3 Contextual Workflow Repair Panel | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-9 | Die UI zeigt den Blocker im Kontext des urspruenglichen Items oder Start-Controls. | ✓ |
| AC-10 | Die UI bietet App-Level-Default-Auswahl oder Identitaetseingabe an, wenn verfuegbar/noetig. | ✓ |
| AC-11 | Repair schreibt repo-local Identitaet nur nach Bestaetigung. | ✓ |
| AC-12 | Das blockierte Item oder die Startabsicht bleibt waehrend Repair sichtbar. | ✓ |
| AC-13 | Die CLI gibt fuer denselben Blocker reparierbare naechste Schritte aus. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-9..AC-13 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/workflowGitRepairPanel.test.tsx` and `npm run test:file --workspace=@beerengineer/engine -- test/cli-actions.test.ts`

## PROJ-5-PRD-4-US-4: Als User moechte ich nach erfolgreichem Repair zum urspruenglichen Start zurueckkehren um den Workflow ohne erneutes Navigieren zu starten — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.4 Continue Original Start After Repair | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Nach Repair wird Workspace-Git-Readiness neu abgefragt. | ✓ |
| AC-15 | Wenn Readiness danach ready ist, wird der urspruengliche Start als Fortsetzen-Aktion verfuegbar. | ✓ |
| AC-16 | Wenn Readiness weiterhin blockiert ist, bleibt der Blocker mit frischem Grund sichtbar. | ✓ |
| AC-17 | Die Fortsetzen-Aktion verwendet die urspruengliche Item-/Workspace-Intent-Information, nicht neu eingegebene Pfade. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-14..AC-17 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/workflowGitRepairPanel.test.tsx`

## PROJ-5-PRD-4-US-5: Als QA moechte ich Partial-Repair- und Signing-Fehler erkennen um Git-Identity-Readiness nicht mit allgemeiner Commit-Readiness zu verwechseln — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.5 Partial Repair And Signing Diagnostics | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-18 | Partial Repair zeigt nach frischem Readiness-Read, ob nur Name oder Email geschrieben wurde. | ✓ |
| AC-19 | Partial Repair wird nicht als erfolgreich abgeschlossen dargestellt. | ✓ |
| AC-20 | Ein Commit-Fehler durch GPG-Signing wird nicht als fehlende Git-Identitaet umetikettiert. | ✓ |
| AC-21 | QA-Dokumentation oder Testnamen machen `commit.gpgsign=true` als separate Failure Mode erkennbar. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-18..AC-21 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/gitIdentityRepair.test.ts` and `npm run test:file --workspace=@beerengineer/engine -- test/gitSigningReadiness.test.ts`

### Wave 4 Gate — PASSED (2026-05-06T13:15:33+02:00)
- [x] Ralph: 21 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: /w/demo /w/demo/items/demo
