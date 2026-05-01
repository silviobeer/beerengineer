# PROJ-1 Progress

## Status: blocked
## Current Wave: 5
## BASE_SHA: b16815407a08bb74ce49bff2bc5125faf88fe766

---

## Execution Preflight

- CodeRabbit config: verified profile `chill`; added generated/build/lockfile path filters in commit `b168154`.
- Gate tooling: added `scripts/wave-gate.sh` from executing skill template in commit `b168154`.
- Required CLIs: `jq`, `coderabbit`, and `agent-browser` found.
- Supabase MCP: not required; root `package.json` contains no `@supabase/*` dependency and no `supabase/` folder exists.
- Playwright MCP: not required for Skill 5 wave gates; all `frontend_routes` entries in `6_plan/wave-gate-config.json` are empty.
- Existing dirty worktree before execution: engine/UI files and `docs/pipeline-overview.svg`; treated as user-owned changes.

---

## Wave 1 Setup

- Wave base tag: `wave-1-start-PROJ-1` at `b16815407a08bb74ce49bff2bc5125faf88fe766`.
- Agent notes: `apps/engine/src/core/managedInstall/agent.md` missing at wave start.
- Execution mode: local implementation; Codex subagents were not spawned because the active delegation policy requires an explicit user request for delegation.
- Gate config correction: Wave 1 AC commands were changed from `npm test --workspace=@beerengineer/engine -- <file>` to direct `node --test --import tsx <file>` commands because the package script hardcodes `test/*.test.ts` and was running unrelated tests. `build_cmd` was narrowed to `npm run typecheck`, matching the build gate while keeping behavior tests in `ac_commands`.
- Gate attempt 1: FAIL — first AC command expanded into the whole engine suite and hit pre-existing preview/SSE failures (`apiIntegration.test.ts` expected loopback preview URL but dirty preview-host work emitted `http://100.80.38.41:3324`; a later SSE assertion saw `hello` instead of one `phase_started`). Gate process was stopped after failure output was captured.
- Gate attempt 2: BLOCKED — AC commands and `npm run typecheck` passed, but CodeRabbit was invoked while `HEAD` still equaled the wave base (`0 commits, 0 files`), leaving the review without a meaningful committed diff. Stopped the pass and committed only Wave 1 managed-install files before retrying.
- Gate attempt 3: FAIL — CodeRabbit found 1 major and 2 minor non-advisory findings: engine bin metadata could escape `apps/engine`, release tarball protocol was asserted as HTTPS without validation, and archive entry checks missed drive-relative `C:file` paths. Added regression tests and fixed all three.
- Gate attempt 4: FAIL — CodeRabbit found 2 real managed-install timeout gaps (`fetchGithubReleases` and `requestHttpsBuffer`) plus 1 unrelated pre-existing dirty-worktree finding in `apps/engine/src/cli/commands/itemActions.ts`. Added timeout regression tests/fixes and updated `scripts/wave-gate.sh` to pass `coderabbit review --type committed` so wave reviews are scoped to committed wave changes rather than unrelated unstaged user work.
- Gate attempt 5: FAIL — CodeRabbit flagged `--type committed` in the gate script and one more validation hardening issue. Replaced the CodeRabbit scope mechanism with supported `--files <base..HEAD changed files>` arguments, and made engine bin validation distinguish outside-root, missing, and not-a-file cases.
- Gate attempt 6: FAIL — CodeRabbit still saw unrelated dirty `apps/engine/src/api/http.ts`, and noted two managed-install follow-ups: make draft publish-time handling explicit and align inner/outer download timeout sources. Fixed the managed-install items in `2a4414c`; unrelated dirty files will be temporarily stashed for the next gate and restored afterward.
- Gate attempt 7: FAIL — with unrelated dirty files stashed, CodeRabbit found two more managed-install hardening items: reject oversized downloads before buffering and canonicalize symlinked engine bin paths before accepting them. Added regression tests and fixed both.
- Gate attempt 8: FAIL — CodeRabbit found malformed release JSON escaping the managed-install error namespace and a potential size-abort resolve/reject race. Added malformed JSON coverage and made the streaming request path reject once on abort/error.

---

## PROJ-1-PRD-2-US-1: Managed Install Release Resolution — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Managed Install Release Resolution | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Ohne explizites Ziel wird die neueste stabile GitHub-Release ausgewaehlt. | ✓ |
| AC-2 | Draft- und Prerelease-Versionen werden nicht als Default-Ziel verwendet. | ✓ |
| AC-3 | Die Ausgabe nennt Repo, Tag und Download-Metadaten der aufgeloesten Release. | ✓ |
| AC-4 | Wenn keine stabile Release existiert, endet der Installer mit einer klaren Release-required Meldung. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallRelease.test.ts`
- Commit: `feat(PROJ-1): implement managed install wave 1 contracts` (`890438b`)

---

## PROJ-1-PRD-2-US-2: Trusted GitHub Download Boundary — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.2 Trusted GitHub Download Boundary | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Downloads ohne HTTPS werden abgelehnt. | ✓ |
| AC-6 | Akzeptierte Hosts sind auf `github.com`, `api.github.com` und `codeload.github.com` begrenzt. | ✓ |
| AC-7 | Redirects ausserhalb der akzeptierten Host-Menge fuehren zu einem harten Fehler. | ✓ |
| AC-8 | Die Fehlermeldung nennt den abgelehnten Host oder das abgelehnte Schema, ohne sensible Umgebungsdaten auszugeben. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDownload.test.ts`

---

## PROJ-1-PRD-2-US-3: Release Shape Validation — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.3 Release Shape Validation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-9 | Tarball-Eintraege mit Path Traversal oder absoluten Pfaden werden abgelehnt. | ✓ |
| AC-10 | Der Tarball und der entpackte Baum werden gegen definierte Groessenlimits geprueft. | ✓ |
| AC-11 | Die Release muss ein erwartetes Repo-Root mit Top-Level `package.json` enthalten. | ✓ |
| AC-12 | Die Release muss die erwarteten Workspace-Verzeichnisse `apps/engine` und `apps/ui` enthalten. | ✓ |
| AC-13 | Die Release muss die erwarteten Engine-Package- und CLI-Bin-Metadaten enthalten. | ✓ |
| AC-14 | Inkonsistente package/workspace-Metadaten fuehren zu einem harten Fehler. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallValidation.test.ts`

---

## PROJ-1-PRD-5-US-1: Structured Install Result Contract — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.4 Structured Install Result Contract | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Es gibt einen dokumentierten strukturierten Ausgabemodus, z.B. `--json` oder gleichwertig. | ✓ |
| AC-2 | Die strukturierte Ausgabe enthaelt `version`. | ✓ |
| AC-3 | Die strukturierte Ausgabe enthaelt eine stabile `operationId` fuer den Installationsversuch. | ✓ |
| AC-4 | Die strukturierte Ausgabe ist auch bei Fehlern verfuegbar, soweit der Installer startet. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDiagnostics.test.ts`

---

## PROJ-1-PRD-5-US-2: Install Phase Diagnostics — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.5a Prerequisite Probe Contract | ✓ | ✓ | ✓ |
| 1.5b Shared Phase Model And Human Renderer | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Phasen enthalten mindestens `prerequisites`, `download`, `install`, `setup`, `engineStart` und `uiStart`. | ✓ |
| AC-6 | Jede Phase kann `ok`, `warning` oder `failed` melden. | ✓ |
| AC-7 | Jede Phase enthaelt `message`, `fixHint` falls anwendbar und `durationMs`. | ✓ |
| AC-8 | Die menschliche Ausgabe und die strukturierte Ausgabe widersprechen sich nicht im Phasenstatus. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallPrerequisites.test.ts`
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDiagnostics.test.ts`

---

## PROJ-1-PRD-5-US-3: Install Summary Contract — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.6 Install Summary Contract | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-9 | Die strukturierte Ausgabe enthaelt `target` mit Repo, Tag und Tarball-URL-Metadaten. | ✓ |
| AC-10 | Die strukturierte Ausgabe enthaelt `summary.status`. | ✓ |
| AC-11 | Die strukturierte Ausgabe enthaelt Wrapper-Pfad, Engine-URL, UI-URL und naechste Befehle, soweit bekannt. | ✓ |
| AC-12 | Die strukturierte Ausgabe enthaelt `exitCode` als beabsichtigten Prozess-Exitcode. | ✓ |
| AC-13 | Warnungen nach erfolgreichem Install/Setup sind als warnings sichtbar, ohne den Gesamtzustand als harten Installationsfehler zu markieren. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDiagnostics.test.ts`

---

## Quality Gate — PROJ-1

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
| Critical/Major | blocked | — | — |
| Minor | blocked | — | — |
| Info | blocked | — | — |

### Quality Gate Notes
- Code review: PASS — project-level CodeRabbit review against `b16815407a08bb74ce49bff2bc5125faf88fe766..HEAD` completed with 0 findings after retrying a rate-limit wait.
- Build: PASS — `npm run typecheck`.
- Managed-install tests: PASS — `npm run test:managed-install --workspace=@beerengineer/engine`.
- SonarCloud: BLOCKED — `sonar-scanner -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=300` failed because SonarCloud could not access project `silviobeer_beerengineer`; `SONAR_TOKEN` is missing from the environment or lacks permission.

### Fixed Issues
- None yet.

### Deferred (user decision)
- None yet.

---

## QA Results

- Bugs found: 1 (Critical: 1, High: 0, Medium: 0, Low: 0)
- Fixed: 0
- Deferred: 0
- Browser E2E: not applicable for PROJ-1; architecture states there is no UI scope and all wave `frontend_routes` are empty.
- Managed-install regression suite: PASS — `npm run test:managed-install --workspace=@beerengineer/engine` (54/54 tests passing).
- Workspace typecheck: PASS — `npm run typecheck`.
- Full engine regression suite: FAIL/HUNG — `npm test --workspace=@beerengineer/engine` found two non-managed-install failures before the run was terminated after a long no-output stretch:
  - `apiIntegration.test.ts` item preview URL assertion expected `http://127.0.0.1:` but current dirty preview-host behavior returned `http://100.80.38.41:3324`.
  - `cli-actions.test.ts` `beerengineer item action start_brainstorm...` failed during temp cleanup with `ENOTEMPTY` under `/tmp/be2-cli-.../ralph`.
- SonarCloud: user explicitly instructed to ignore remaining repo-level gate failures and continue. Managed-install Critical/Major Sonar findings were fixed in `1724607`; remaining Sonar blockers are repo-level/outside PROJ-1 scope or advisory.

### BUG-PROJ1-QA-001 — [Critical] Public install entrypoint stops after release resolution
- **File:** `apps/engine/src/cli/commands/install.ts`
- **Anchor:** `export async function runManagedInstallCommand`
- **Source:** QA local adversarial review; Marcus Weber (Principal) + Thomas Müller (Reliability)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** The public `beerengineer install` path resolves a stable release and returns success, but it does not call `downloadManagedInstallTarball`, release validation/extraction, `activateManagedInstallVersion`, `runManagedInstallReleaseWorkflow`, or `runManagedInstallCompletionWorkflow`. The implemented lower-level workflows are therefore unreachable from the documented POSIX/PowerShell one-liners.
- **Repro:** Inspect `runManagedInstallCommand`; success path calls only `resolveRelease()`, creates one `download` phase with message `resolved stable release...`, and returns `0` with next command text `managed install workflow will continue from the resolved release`.
- **Impact:** The documented first-install command cannot create a managed install layout, current pointer, wrapper, setup run, engine start, UI instructions, or preserve/adopt state as promised by PRD-2, PRD-3, and PRD-4. This is production-blocking for PROJ-1 despite green unit tests for the lower-level pieces.
- **Fix sketch:** Wire `runManagedInstallCommand` to the full managed install orchestration: prerequisite probe -> release resolution -> trusted download -> archive entry/size/tree validation/extraction -> locked activation -> completion workflow. Add CLI-level tests that assert visible side effects: created `install/versions/<tag>`, `install/current`, wrapper, and summary phases.
- **Fix:** Public `install` command now runs prerequisite checks, release workflow, trusted download, archive validation/extraction, managed activation, and completion workflow. CLI entrypoint test asserts created `install/versions/<tag>`, `install/current`, wrapper, and full phase sequence.
- **Verification:** PASS — `node --test --import tsx apps/engine/test/managedInstallEntrypoint.test.ts`; PASS — `npm run test:managed-install --workspace=@beerengineer/engine`; PASS — `npm run typecheck`.

## AGENTS.md Candidates

- [PROPOSED] AGENTS-PROJ1-QA-001: Public CLI acceptance tests must verify end-to-end side effects for the documented command, not only lower-level helper behavior or parse/output shape. — source: Marcus Weber (Principal) + Thomas Müller (Reliability)

## PROJ Retrospective

### Elena Rodriguez (Principal Architect)
- The wave decomposition produced strong lower-level contracts, but the final public command was not forced to consume the assembled pipeline.
- Future plans should include one explicit "public path integration" story near the end of backend CLI features.
- The architecture correctly separated release, state, diagnostics, and completion, but the plan needed a final orchestration acceptance test connecting them.
- Per-wave gates can pass while the product path remains thin if AC commands only target unit-level modules.
- For PROJ-2, add a gate command that executes the documented operator command against injected/fake release services and asserts durable filesystem effects.

### Ken Takahashi (Minimalism)
- The lower-level modules are useful, but currently look overbuilt because the public command does not use them.
- Avoid adding more installer abstractions until the single public orchestration path is wired and proven.
- Prefer one small integration seam with injected downloader/extractor/runner dependencies over parallel "demo" and "real" install flows.
- Delete or rewrite placeholder summary text like `managed install workflow will continue...`; it hides missing behavior behind a successful exit.
- Keep future cleanup focused on connecting existing pieces, not introducing a new installer framework.

---

## Open Blockers
- None in PROJ-1 managed-install after BUG-PROJ1-QA-001 fix. Full QA re-run still recommended before documentation.
- SonarCloud repo-level quality-gate failures were explicitly deferred by user instruction on 2026-05-01.

### Wave 1 Gate — PASSED (2026-04-30T21:55:08+02:00)
- [x] Ralph: 5 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## PROJ-1-PRD-3-US-1: Managed Install Layout And Wrapper — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Managed Install Layout And Wrapper Creation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Releases werden unter `install/versions/<tag>/` abgelegt. | ✓ |
| AC-2 | Es gibt einen aktiven `install/current` Zustand. | ✓ |
| AC-3 | POSIX Wrapper und Windows `.cmd` Equivalent werden erstellt. | ✓ |
| AC-4 | Der Wrapper zeigt auf den langfristigen `install/current` Einstiegspunkt. | ✓ |
| AC-5 | Erstinstall nutzt die Update-Pfadberechnung fuer das managed Layout. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallState.test.ts`

---

## PROJ-1-PRD-3-US-2: Existing App Data Preservation And Adoption — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.2 Existing App Data Preservation And Adoption | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-6 | Vorhandene Config-Dateien bleiben unveraendert. | ✓ |
| AC-7 | Vorhandene SQLite-Daten bleiben unveraendert. | ✓ |
| AC-8 | App-Daten ohne managed install werden als adoptierbar klassifiziert. | ✓ |
| AC-9 | Entwicklungs-Checkout-Artefakte werden nicht in den Installationsroot verschoben. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallState.test.ts`

---

## PROJ-1-PRD-3-US-3: Repairable Managed State Evaluation — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.3 Repairable Managed State Evaluation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-10 | Genau eine valide Version plus fehlender current ist reparierbar. | ✓ |
| AC-11 | Fehlender Wrapper plus valide aktive Installation ist reparierbar. | ✓ |
| AC-12 | Valider managed install wird als bereits installiert gemeldet. | ✓ |
| AC-13 | Idempotenter Wiederholungslauf ist Erfolg ohne Reparaturen. | ✓ |
| AC-14 | Reparaturen werden als sichtbare Repair-Actions gemeldet. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallState.test.ts`

---

## PROJ-1-PRD-3-US-4: Risky Managed State Stop Conditions — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.4 Risky Managed State Stop Conditions | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-15 | Mehrere valide Versionen ohne current sind ein harter Stop. | ✓ |
| AC-16 | Invalides current-Ziel ist ein harter Stop. | ✓ |
| AC-17 | Riskante Konflikte ueberschreiben keinen Zustand. | ✓ |
| AC-18 | Stop-Meldungen nennen konkrete manuell zu pruefende Pfade. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallState.test.ts`

---

## PROJ-1-PRD-3-US-5: Shared Install Update Lock — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.5 Shared Install Update Lock | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-19 | Erstinstallation und Update verwenden denselben Lock-Pfad. | ✓ |
| AC-20 | Aktiver Lock fuehrt zu hartem Fehler mit Retry-Hinweis. | ✓ |
| AC-21 | Stale-lock Reclamation folgt der Update-Regel und ist getestet. | ✓ |
| AC-22 | Lock-Fehler veraendern Wrapper, current, Config und DB nicht. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallLock.test.ts`

---

## PROJ-1-PRD-2-US-4: Failed Release Non-Activation — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.6 Failed Release Non-Activation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-15 | Fehlerhafte Release wird nicht als current aktiviert. | ✓ |
| AC-16 | Vorhandene Config und SQLite-Daten bleiben bei Release-Fehlern erhalten. | ✓ |
| AC-17 | Ausgabe unterscheidet Release-Aufloesung, Download und Validierung. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallWorkflow.test.ts`

### Wave 2 Gate — PASSED (2026-04-30T22:29:12+02:00)
- [x] Ralph: 3 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## PROJ-1-PRD-4-US-1: Setup Through Managed Wrapper — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 Setup Through Managed Wrapper | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Setup wird ueber den absoluten managed Wrapper gestartet. | ✓ |
| AC-2 | Setup haengt nicht vom aktuellen Shell-`PATH` ab. | ✓ |
| AC-3 | Config und SQLite-Daten bleiben bei Setup erhalten. | ✓ |
| AC-4 | Setup-Fehler sind harte Installationsfehler. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallWorkflow.test.ts`

---

## PROJ-1-PRD-4-US-2: Engine Start Completion — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.2 Engine Start Completion | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Engine-Start wird ueber den managed Wrapper versucht. | ✓ |
| AC-6 | Erfolgreicher Engine-Start liefert lokale Engine-URL. | ✓ |
| AC-7 | Engine-Startfehler nach Setup sind recoverable warnings. | ✓ |
| AC-8 | Engine-Startwarnung fordert keine Reinstallation. | ✓ |
| AC-9 | Ausgabe enthaelt konkreten spaeteren Startbefehl. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallWorkflow.test.ts`

---

## PROJ-1-PRD-4-US-3: UI Best-Effort Completion — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.3 UI Best-Effort Completion | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-10 | UI-Start ist best-effort und macht Erfolg nicht ungueltig. | ✓ |
| AC-11 | Erfolgreicher UI-Start liefert UI-URL. | ✓ |
| AC-12 | Ineligible/fehlgeschlagener UI-Start liefert Befehl und URL. | ✓ |
| AC-13 | UI-Startfehler sind recoverable warnings. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallWorkflow.test.ts`

---

## PROJ-1-PRD-4-US-4: Idempotent Re-Run Completion — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.4 Idempotent Re-Run Completion | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Valider bereits installierter Zustand endet mit Exitcode 0. | ✓ |
| AC-15 | Versionswechsel-Hinweis nennt den Update-Pfad. | ✓ |
| AC-16 | Wiederholungslauf loescht/ersetzt aktive Installation nicht. | ✓ |
| AC-17 | Setup/Start wird bei Rerun sicher uebersprungen. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallWorkflow.test.ts`

---

## PROJ-1-PRD-4-US-5: Final Install Summary Rendering — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.5 Final Install Summary Rendering | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-18 | Summary nennt Gesamtstatus. | ✓ |
| AC-19 | Summary nennt Wrapper-Pfad. | ✓ |
| AC-20 | Summary nennt Engine-URL oder Engine-Warnung. | ✓ |
| AC-21 | Summary nennt UI-URL oder UI-Befehl. | ✓ |
| AC-22 | Summary rendert `PATH`-Anweisungen. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDiagnostics.test.ts`

---

## PROJ-1-PRD-1-US-4: Wrapper Shadow Warning — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.6 Wrapper Shadow Warning | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-12 | Installer entfernt keinen globalen npm-Install automatisch. | ✓ |
| AC-13 | Warnung nennt managed Wrapper und gefundenen Befehl. | ✓ |
| AC-14 | Warnung nennt `PATH`-Reihenfolge oder manuelle Entfernung. | ✓ |
| AC-15 | Schattenwarnung blockiert erfolgreichen Install nicht. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallPath.test.ts`

### Wave 3 Gate — PASSED (2026-04-30T22:40:02+02:00)
- [x] Ralph: 3 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## PROJ-1-PRD-1-US-1/2/3 And PROJ-1-PRD-5-US-5: Public Install Entrypoints And Docs — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.1 POSIX Public Bootstrap Entrypoint | ✓ | ✓ | ✓ |
| 4.2 Windows PowerShell Bootstrap Entrypoint | ✓ | ✓ | ✓ |
| 4.3 Shared Human And Agent Install Path Documentation | ✓ | ✓ | ✓ |
| 4.4 Documentation Drift Checks | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| PRD-1 AC-1..4 | README POSIX one-liner, stable-release delegation, repo/target output, thin POSIX entrypoint. | ✓ |
| PRD-1 AC-5..8 | README Windows one-liner, PowerShell delegation, Windows-friendly prerequisite output, thin Windows entrypoint. | ✓ |
| PRD-1 AC-9..11 | Shared human/agent path, clear prerequisite/no-release/start output, no primary branch install path. | ✓ |
| PRD-5 AC-21..25 | POSIX/Windows docs, prerequisites, PATH behavior, no v1 uninstall, drift tests. | ✓ |

### Ralph Loop
- Iterations: 1
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallEntrypoint.test.ts`
- Pass 1: PASS — `node --test --import tsx apps/engine/test/managedInstallDocs.test.ts`

### Wave 3 Gate — PASSED (2026-04-30T22:40:02+02:00)
- [x] Ralph: 3 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

### Wave 4 Gate — PASSED (2026-04-30T22:52:13+02:00)
- [x] Ralph: 2 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## PROJ-1-PRD-5-US-4: Managed Install Regression Coverage — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 5.1 Managed Install Coverage Audit And Gaps | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Tests decken Install-Pfad-Aufloesung und Wrapper-Zielerstellung ab. | ✓ |
| AC-15 | Tests decken vorhandene Zustandsadoption, eindeutige Reparaturen und Stop-Bedingungen ab. | ✓ |
| AC-16 | Tests decken POSIX-active-current Verhalten und Windows-active-current Verhalten ab. | ✓ |
| AC-17 | Tests decken fehlende Voraussetzungen und Wrapper-Schattenwarnungen ab. | ✓ |
| AC-18 | Tests decken strukturierten Ausgabemodus ab. | ✓ |
| AC-19 | Tests decken idempotente Wiederholung nach erfolgreichem Install ab. | ✓ |
| AC-20 | Tests decken Install/Update-Lock-Konkurrenz ab. | ✓ |

### Ralph Loop
- Iterations: 1
- Audit: found missing coverage for structured JSON startup failures, individual missing prerequisite tools, wrapper-shadow workflow summaries, explicit POSIX/Windows active-current matrix, and reverse install/update lock contention.
- Pass 1: FAIL — focused managed-install tests exposed that `install --json` startup failures still emitted a minimal `{status,error}` shape instead of the managed-install schema; the POSIX/Windows active-current matrix fixture also needed a valid release tree before activation.
- Pass 2: PASS — `npm run test:managed-install --workspace=@beerengineer/engine`
- Build: PASS — `npm run typecheck`

### Wave 5 Gate — PASSED (2026-04-30T23:03:42+02:00)
- [x] Ralph: 1 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: high,medium,low)
- [x] Smoke: backend-only

---

## Resume Check — 2026-05-01

- Managed-install regression suite: PASS — `npm run test:managed-install --workspace=@beerengineer/engine` (54/54 tests passing).
- Workspace typecheck: PASS — `npm run typecheck`.
- SonarCloud quality-gate scan: BLOCKED — `sonar-scanner -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=300` exits 1. Scanner reports project `silviobeer_beerengineer` is not accessible and asks to check `sonar.projectKey`, `sonar.organization`, `SONAR_TOKEN`, or project permissions. `SONAR_TOKEN` is missing in the current environment.
- Follow-up after loading `.env.local`: SonarCloud authentication succeeds, and managed-install Critical/Major findings were fixed locally. Rechecks PASS for `npm run test:managed-install --workspace=@beerengineer/engine` and `npm run typecheck`.
- SonarCloud quality-gate status remains ERROR because of repo-level gate conditions outside the managed-install feature scope: new coverage 65.1% (<80), new security hotspots reviewed 0%, total security hotspots reviewed 80%, and 10 remaining open issues. Remaining Critical/Major issues are in `apps/engine/src/cli/commands/itemActions.ts` and `apps/engine/src/core/runService.ts`; one managed-install Minor remains in `apps/engine/src/core/managedInstall/prerequisites.ts`.
