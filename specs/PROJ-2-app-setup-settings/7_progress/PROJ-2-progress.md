# PROJ-2 Progress

## Status: QA passed
## Current Wave: QA fix pass complete
## BASE_SHA: 35b6ee5c43f6b871b832ad6800c704562149b242

---

## Preflight

- CodeRabbit config: present at `.coderabbit.yaml`; `reviews.profile: chill`; excludes generated/dependency paths and lockfiles.
- Required CLIs: `agent-browser`, `coderabbit`, and `jq` present.
- Supabase MCP: not required; no `@supabase/*` dependency and no `supabase/` folder found.
- Playwright MCP: required by frontend waves 4 and 5; available in this Codex session.
- Wave gate script: present at `scripts/wave-gate.sh`.

---

## Wave 1

### Wave Start
- Status: complete
- Base tag: `wave-1-start-PROJ-2`
- Started after local tag creation at `35b6ee5c43f6b871b832ad6800c704562149b242`.

## PROJ-2-PRD-1-US-1: Setup-Status anzeigen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Setup Readiness Classification | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Der Setup-Status unterscheidet required, recommended und optional checks eindeutig. | ✓ |
| AC-2 | Required failures markieren, dass der naechste Setup-Schritt blockiert ist. | ✓ |
| AC-3 | Fehlende Tools oder Auth-Zustaende enthalten stabile Check-IDs, Status, Label, Beschreibung und Remedy-Hinweis. | ✓ |
| AC-4 | Die Antwort bleibt kompatibel mit dem bestehenden `GET /setup/status` Readiness-Modell oder dokumentiert jede notwendige Erweiterung. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-3 pass 1: FAIL — `generateSetupReport({ overrides: { llmProvider: "opencode" } })` did not include `llm.opencode.cli` when the config file was missing because the active LLM group was derived only from an on-disk ok config. Updated `apps/engine/src/setup/doctor.ts` to derive the active group from the effective merged config.
- AC-1..AC-4 pass 2: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupStatus.test.ts`.
- Commit: `feat(PROJ-2-PRD-1): implement app setup foundation` (`682d494`)

---

## PROJ-2-PRD-1-US-2: App-State initialisieren — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Idempotent App-State Initialization | ✓ | ✓ | ✓ |
| 2.2 Initialization API Boundary | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Die Initialisierung kann Config, Datenverzeichnis und SQLite-State anlegen, wenn sie fehlen. | ✓ |
| AC-6 | Vorhandene gueltige Werte bleiben unveraendert. | ✓ |
| AC-7 | Eine ungueltige vorhandene Config wird nicht stillschweigend ueberschrieben, sondern als reparaturbeduerftiger Zustand gemeldet. | ✓ |
| AC-8 | Mutierende Initialisierungsaufrufe sind CSRF-geschuetzt. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-5..AC-8 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appSetupInit.test.ts` and `npm run test:file --workspace=@beerengineer/engine -- test/setupApi.test.ts`.
- Commit: `feat(PROJ-2-PRD-1): implement app setup foundation` (`682d494`)

---

## PROJ-2-PRD-1-US-3: Effektive App-Config lesen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 Effective App Config Read Model | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-9 | Die Antwort enthaelt app-weite Felder wie `allowedRoots`, `enginePort`, `publicBaseUrl`, Default-LLM/Harness, GitHub enabled, Browser enabled und Telegram enabled/message level. | ✓ |
| AC-10 | Secret-Felder werden nur als Referenz oder Metadaten geliefert, nie als Klartextwert. | ✓ |
| AC-11 | Workspace- oder project-spezifische Einstellungen sind nicht Teil dieser Antwort. | ✓ |
| AC-12 | Die UI kann aus der Antwort zwischen uninitialisiert, teilweise konfiguriert und setup-complete unterscheiden. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-11 pass 1: FAIL — assertion rejected the literal default allowed root path `/home/silvio/projects`, although allowedRoots is an app-wide field. Tightened the test to reject workspace/project config keys.
- AC-9..AC-12 pass 2: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigView.test.ts`.
- Commit: `feat(PROJ-2-PRD-1): implement app setup foundation` (`682d494`)

---

## Quality Gate — PROJ-2

### Code Review
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| P0 Critical | 0 | 0 | 0 |
| P1 High | 1 | 1 | 0 |
| P2 Medium | 3 | 3 | 0 |
| P3 Low | 2 | 2 | 0 |

### SonarCloud
| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| Critical/Major | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 |
| Info | 0 | 0 | 0 |

### Fixed Issues
- P1: `BUG-PROJ2-QA-001` — fresh `/setup` can now initialize missing app state through a UI proxy and gate action.
- P2: `BUG-PROJ2-QA-002` — mobile topbar hides decorative brand under `sm` to avoid 375px overlap.
- P2: `BUG-PROJ2-QA-003` — secret test failures now display the engine-provided `message`.
- P2: `BUG-PROJ2-QA-004` — recommended review gates now render `Recommended` while keeping `Next` enabled.
- P3: `BUG-PROJ2-QA-005` — settings status now separates passed check totals from required thresholds.
- P3: `BUG-PROJ2-QA-006` — optional-skip route now rejects non-optional group ids.

### Deferred (user decision)
- None.

---

## QA Results

- Bugs found: 6 (Critical: 0, High: 1, Medium: 3, Low: 2)
- Fixed: 6
- Deferred: 0

---

## Open Blockers
- None.

---

## Execution Notes

- 2026-05-02: Corrected `6_plan/wave-gate-config.json` AC commands to use workspace-relative test paths (`test/...` for engine, `tests/...` for UI); the original repo-root paths failed before tests executed under `npm --workspace`.
- 2026-05-02: Tightened `apps/engine/test/appConfigView.test.ts` AC-11 so it rejects workspace/project config keys without failing on the legitimate default allowed root path `/home/silvio/projects`.
- 2026-05-02: Verification passed for Wave 1 AC tests and repo typecheck: `npm run test:file --workspace=@beerengineer/engine -- test/setupStatus.test.ts`, `test/appSetupInit.test.ts`, `test/setupApi.test.ts`, `test/appConfigView.test.ts`, and `npm run typecheck`.

### Wave 1 Gate — PASSED (2026-05-02T12:24:49+02:00)
- [x] Ralph: 12 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 2

### Wave Start
- Status: complete
- Base tag: `wave-2-start-PROJ-2`
- Started after Wave 1 gate at `682d494`.

## PROJ-2-PRD-1-US-4: App-Config teilweise speichern — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Partial App Config Patch | ✓ | ✓ | ✓ |
| 1.2 Protected Config Mutation Route | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-13 | Partial-save Antworten listen gespeicherte und abgelehnte Felder getrennt auf. | ✓ |
| AC-14 | Ungueltige Felder bleiben unveraendert persistiert. | ✓ |
| AC-15 | `enginePort` wird als Future-start-Wert gespeichert und aendert den laufenden Engine-Port nicht live. | ✓ |
| AC-16 | Mutierende Config-Patches sind CSRF-geschuetzt. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-13..AC-16 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts` and `test/setupApi.test.ts`.
- Commit: `feat(PROJ-2-PRD-2): add config patch and secrets` (`a5bbcfc`)

---

## PROJ-2-PRD-1-US-5: Checks wiederholen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Re-check API Contract | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-17 | Re-checks liefern frische Statuswerte und verlassen sich nicht auf stale UI-State. | ✓ |
| AC-18 | Re-checks koennen gruppiert nach Setup-Schritt oder als kompletter Statuslauf ausgefuehrt werden. | ✓ |
| AC-19 | Transiente Check-Fehler werden als verstaendlicher Fehlerzustand gemeldet und nicht als erfolgreiche Ready-Antwort. | ✓ |
| AC-20 | Required Gate-Status ist eindeutig genug, damit die UI `Next` aktivieren oder deaktivieren kann. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-17..AC-20 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/setupRecheck.test.ts`.
- Commit: `feat(PROJ-2-PRD-2): add config patch and secrets` (`a5bbcfc`)

---

## PROJ-2-PRD-2-US-1: Secret-Werte lokal speichern — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 File-backed Secret Store Foundation | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-1 | Secret-Werte werden nicht in `.env.local`, Repo-Dateien, Workspace-Dateien oder normaler App-Config persistiert. | ✓ |
| AC-2 | Der Secret Store liegt in einem OS-aware beerengineer State- oder Datenpfad ausserhalb registrierter Workspaces. | ✓ |
| AC-3 | App-Config enthaelt nur Secret-Referenzen und redaktierte Metadaten. | ✓ |
| AC-4 | Gespeicherte Secret-Werte werden nie ueber HTTP als Klartext zurueckgegeben. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-4 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/secretStore.test.ts`.
- Commit: `feat(PROJ-2-PRD-2): add config patch and secrets` (`a5bbcfc`)

---

## PROJ-2-PRD-2-US-3: Secret Lifecycle warten — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.1 Secret Lifecycle Actions | ✓ | ✓ | ✓ |
| 4.2 Protected Secret Mutation Routes | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-9 | Replace ersetzt den gespeicherten Wert, ohne den alten Wert an die UI auszugeben. | ✓ |
| AC-10 | Disable behaelt den Wert, aber markiert ihn als nicht aktiv. | ✓ |
| AC-11 | Reactivate macht einen deaktivierten Wert wieder aktiv, falls er noch existiert. | ✓ |
| AC-12 | Delete entfernt den gespeicherten Wert und meldet danach missing. | ✓ |
| AC-13 | Mutierende Secret-Aktionen sind CSRF-geschuetzt. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-9..AC-13 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/secretActions.test.ts` and `test/secretApi.test.ts`.
- Commit: `feat(PROJ-2-PRD-2): add config patch and secrets` (`a5bbcfc`)

---

## Wave 2 Verification

- 2026-05-02: `npm run typecheck` passed after Wave 2 implementation.
- 2026-05-02: Wave 2 gate CodeRabbit pass 1 failed with 5 non-advisory findings: awaited async setup handlers, preserved sibling config objects on partial patch, rejected empty `allowedRoots`, and prevented invalid secret actions from defaulting to delete.
- 2026-05-02: Review fixes verified with `npm run test:file --workspace=@beerengineer/engine -- test/appConfigPatch.test.ts`, `test/secretActions.test.ts`, `test/secretApi.test.ts`, and `npm run typecheck`.
- Commit: `fix(PROJ-2-PRD-2): address wave 2 review findings` (`fe14d41`)
- 2026-05-02: Wave 2 gate CodeRabbit pass 2 found an existing dirty execution-hook type mismatch in `waveExecution.ts`; fixed the hook signature to match `RalphStoryRuntimeHooks.onCycleBoundary`.
- 2026-05-02: Execution-hook fix verified with `npm run typecheck`, `npm run test:file --workspace=@beerengineer/engine -- test/waveCoordinator.test.ts`, and `test/ralphRuntime.test.ts`.
- Commit: `fix(engine): align wave cycle boundary hook` (`c4133ec`)
- 2026-05-02: Wave 2 gate CodeRabbit pass 3 reviewed generated `.playwright-mcp/` snapshots; added that local tool-output directory to `.coderabbit.yaml` path filters.
- Commit: `chore(coderabbit): ignore playwright mcp snapshots` (`2869b17`)
- 2026-05-02: Wave 2 gate CodeRabbit pass 4 found a flaky AC-17 timestamp assertion; added a small delay and stricter increasing-timestamp assertion.
- Commit: `test(PROJ-2-PRD-1): stabilize setup recheck timestamp` (`6815d96`)

### Wave 2 Gate — PASSED (2026-05-02T12:56:49+02:00)
- [x] Ralph: 17 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 3

### Wave Start
- Status: complete
- Base tag: `wave-3-start-PROJ-2`
- Started after Wave 2 gate at `6815d96`.

## PROJ-2-PRD-2-US-2: Secret-Status sehen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Redacted Secret Metadata Read Model | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-5 | Secret-Metadaten unterscheiden mindestens missing, active, disabled, invalid/suspicious und unknown. | ✓ |
| AC-6 | Last-tested oder last-updated Metadaten werden geliefert, wenn vorhanden. | ✓ |
| AC-7 | Redaktion ist auch bei Fehlerantworten gewaehrleistet. | ✓ |
| AC-8 | Optional-service Readiness kann Secret-Metadaten verwenden, ohne Klartextwerte an die UI zu senden. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-5..AC-8 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/secretMetadata.test.ts`.

---

## PROJ-2-PRD-2-US-4: Secrets explizit testen — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 2.1 Explicit Secret Test Runner | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-14 | Secret-Tests koennen gespeicherte Secret-Store-Werte in kontrollierte Check-Umgebungen injizieren. | ✓ |
| AC-15 | Ein expliziter Test darf ein nachweislich ungueltiges Secret deaktivieren, wenn die Check-Art diese Aussage sicher erlaubt. | ✓ |
| AC-16 | Transiente Netzwerk-, Rate-Limit- oder Service-Fehler deaktivieren ein Secret nicht automatisch. | ✓ |
| AC-17 | Testergebnisse enthalten UI-verstaendliche Status- und Fehlertexte ohne Klartext-Secret. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-14..AC-17 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/secretTests.test.ts`.

---

## PROJ-2-PRD-2-US-5: Optionale Secret-Gates — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 3.1 Optional Secret Gate Semantics | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-18 | Fehlende optionale Secrets blockieren keine required Gates. | ✓ |
| AC-19 | Die Antwort unterscheidet optional skipped, optional configured und optional failed. | ✓ |
| AC-20 | Die UI kann daraus einen aktivierten `Skip`-Zustand fuer optionale Gate-Boxen ableiten. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-18..AC-20 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/optionalSecretReadiness.test.ts`.

---

## PROJ-2-PRD-2-US-6: Gespeicherte Secrets verwenden — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 4.1 Scoped Secret Resolution For Checks And Tools | ✓ | ✓ | ✓ |
| 4.2 Secret Leak Regression Coverage | ✓ | ✓ | ✓ |

### Acceptance Criteria
| AC | Text | Verified |
|----|------|:---:|
| AC-21 | Setup/Doctor Checks koennen gespeicherte Secret-Store-Werte verwenden, wenn der Check das Secret explizit benoetigt. | ✓ |
| AC-22 | Tool-Ausfuehrungen koennen gespeicherte Secret-Store-Werte verwenden, wenn das jeweilige Feature das Secret explizit benoetigt. | ✓ |
| AC-23 | Deaktivierte, geloeschte oder fehlende Secrets werden nicht in Check- oder Tool-Umgebungen injiziert. | ✓ |
| AC-24 | Die Engine stellt Secret-Werte nur fuer die Dauer der konkreten Ausfuehrung bereit und persistiert keine materialisierten Secret-Werte an anderer Stelle. | ✓ |
| AC-25 | Wenn sowohl Prozess-Environment als auch Secret Store einen Wert liefern koennen, muss die verwendete Quelle deterministisch sein und in Metadaten/Status ohne Klartextwert nachvollziehbar bleiben. | ✓ |

### Ralph Loop
- Iterations: 1
- AC-21..AC-25 pass 1: PASS — `npm run test:file --workspace=@beerengineer/engine -- test/secretResolver.test.ts`.

---

## Wave 3 Verification

- 2026-05-02: Wave 3 acceptance files and `npm run typecheck` passed locally.
- Commit: `feat(PROJ-2-PRD-2): add secret readiness integration` (`86c8d33`)

### Wave 3 Gate — PASSED (2026-05-02T13:04:24+02:00)
- [x] Ralph: 16 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: backend-only

---

## Wave 4

### Wave Start
- Status: complete
- Base tag: `wave-4-start-PROJ-2`
- Started after Wave 3 gate at `86c8d33`.

## PROJ-2-PRD-3-US-1..US-6: Setup Wizard UI — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 Setup Entry And Error Boundary | ✓ | ✓ | ✓ |
| 2.1 Setup Progress Stepper | ✓ | ✓ | ✓ |
| 3.1 Setup Gate Box State Machine | ✓ | ✓ | ✓ |
| 4.1 Setup Support Material | ✓ | ✓ | ✓ |
| 5.1 Re-check Interaction | ✓ | ✓ | ✓ |
| 6.1 Optional Gate Skip/Defer | ✓ | ✓ | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-24 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/setupEntry.test.tsx tests/setupProgressStepper.test.tsx tests/setupGateBox.test.tsx tests/setupSupportZone.test.tsx tests/setupRecheckFlow.test.tsx tests/setupOptionalGates.test.tsx`.

---

## Wave 5

### Wave Start
- Status: complete
- Base tag: `wave-5-start-PROJ-2`
- Started after Wave 4 implementation in the same UI pass.

## PROJ-2-PRD-4-US-1..US-5: Settings Maintenance UI — complete

### Tasks
| Task | Tests Written | Tests Passing | Done |
|------|:---:|:---:|:---:|
| 1.1 App Settings Page Shell | ✓ | ✓ | ✓ |
| 2.1 App Config Settings Form | ✓ | ✓ | ✓ |
| 3.1 Partial Save Feedback | ✓ | ✓ | ✓ |
| 4.1 Secret Maintenance Rows | ✓ | ✓ | ✓ |
| 5.1 Settings Re-check Controls | ✓ | ✓ | ✓ |

### Ralph Loop
- Iterations: 1
- AC-1..AC-20 pass 1: PASS — `npm test --workspace=@beerengineer/ui -- tests/settingsPage.test.tsx tests/settingsConfig.test.tsx tests/settingsPartialSave.test.tsx tests/settingsSecrets.test.tsx tests/settingsRecheck.test.tsx`.

---

## Wave 4/5 Verification

- 2026-05-02: UI acceptance files for Waves 4 and 5 passed together: 44 tests across 11 files.
- 2026-05-02: `npm run typecheck` passed for engine and UI workspaces.

### Wave 4 Gate — PASSED (2026-05-02T23:04:55+02:00)
- [x] Ralph: 24 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: /setup

### Wave 5 Gate — PASSED (2026-05-02T23:16:35+02:00)
- [x] Ralph: 20 AC commands green
- [x] Build: `npm run typecheck`
- [x] CodeRabbit: 0 non-advisory findings (advisory severities: medium,low)
- [x] Smoke: /settings

---

## QA Results — 2026-05-03

- Verdict: fail for user release. Automated gates pass, but browser QA found one High first-run blocker and several Medium/Low UX/contract defects.
- Environment: isolated engine on `127.0.0.1:4713`, isolated UI on `127.0.0.1:3113`, temp state under `/tmp/be2-qa-proj2-Bx7x3O`.
- Evidence: `.playwright-mcp/setup-after-recheck.yml`, `.playwright-mcp/setup-after-init.yml`, `.playwright-mcp/settings-initial.yml`, `.playwright-mcp/settings-secret-tested.yml`, `setup-mobile.png`, `settings-mobile.png`, `.playwright-mcp/network-settings.log`.
- Verification passed: `npm run typecheck`; `npm test --workspace=@beerengineer/ui -- tests/setupEntry.test.tsx tests/setupGateBox.test.tsx tests/setupSupportZone.test.tsx tests/settingsSecrets.test.tsx tests/settingsConfig.test.tsx tests/settingsRecheck.test.tsx`; `npm run test:file --workspace=@beerengineer/engine -- test/setupApi.test.ts test/appConfigPatch.test.ts test/secretStore.test.ts test/secretMetadata.test.ts test/secretTests.test.ts`.
- Fix-pass verification passed: `npm test --workspace=@beerengineer/ui -- tests/setupEntry.test.tsx tests/setupGateBox.test.tsx tests/setupSupportZone.test.tsx tests/setupOptionalGates.test.tsx tests/setupRecheckFlow.test.tsx tests/settingsSecrets.test.tsx tests/settingsConfig.test.tsx tests/settingsRecheck.test.tsx tests/settingsPage.test.tsx tests/settingsPartialSave.test.tsx tests/setupProgressStepper.test.tsx`; `npm run typecheck`.

## QA Re-run — 2026-05-03

- Verdict: passed. No Critical, High, Medium, or Low QA bugs remain open.
- Environment: isolated engine on `127.0.0.1:4723`, isolated UI on `127.0.0.1:3123`, temp state under `/tmp/be2-qa-rerun-h1y2KM`.
- Evidence: `qa-rerun-setup-initial.yml`, `qa-rerun-setup-after-init.yml`, `qa-rerun-settings-initial.yml`, `qa-rerun-settings-secret-test.yml`, `qa-rerun-setup-mobile.png`, `qa-rerun-settings-mobile.png`, `qa-rerun-console-errors.log`, `qa-rerun-network.log`.
- Verified fixed: `BUG-PROJ2-QA-001` setup initialization button/proxy; `BUG-PROJ2-QA-002` 375px topbar no longer overlaps; `BUG-PROJ2-QA-003` secret test displays the engine not-implemented message; `BUG-PROJ2-QA-005` settings status displays checks plus threshold; `BUG-PROJ2-QA-006` optional skip rejects `review` and accepts `notifications`.
- Final re-check fixed: `BUG-PROJ2-QA-004` now renders `Recommended` for the real engine-backed recommended review gate while `Next` stays enabled.
- Root cause fixed: `GET /setup/status` can report the review group as `level: "recommended"` and `ideal: true` while a non-required check is still missing; the UI now maps recommended current groups to `Recommended` instead of borrowing the missing check's blocked label.
- Console/network notes: only expected favicon `404` and expected `501` from the explicit unimplemented secret test were observed; no secret values appeared in snapshots or network summaries.
- Verification passed: `npm test --workspace=@beerengineer/ui -- tests/setupEntry.test.tsx tests/setupGateBox.test.tsx tests/setupSupportZone.test.tsx tests/setupOptionalGates.test.tsx tests/setupRecheckFlow.test.tsx tests/settingsSecrets.test.tsx tests/settingsConfig.test.tsx tests/settingsRecheck.test.tsx tests/settingsPage.test.tsx tests/settingsPartialSave.test.tsx tests/setupProgressStepper.test.tsx`; `npm run typecheck`; `npm run test:file --workspace=@beerengineer/engine -- test/setupApi.test.ts test/appConfigPatch.test.ts test/secretStore.test.ts test/secretMetadata.test.ts test/secretTests.test.ts`.

### BUG-PROJ2-QA-001 — [High] Fresh setup page cannot initialize missing app state
- **File:** `apps/ui/components/setup/SetupGateBox.tsx`; `apps/ui/app/api/setup/`
- **Anchor:** `export function SetupGateBox`
- **Source:** Playwright E2E + Marcus Weber (Principal Engineer) + Elena Rodriguez (Architecture)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** With a missing config, `/setup` shows the config-missing blocker, a disabled `Next`, and `Re-check`, but no UI action or Next.js proxy route invokes `POST /setup/init`. The engine endpoint exists and succeeds when called directly, so the browser first-run flow cannot satisfy PRD-1 US-2 without CLI/API knowledge.
- **Repro:** Start engine with `BEERENGINEER_CONFIG_PATH` pointing to a nonexistent file, navigate to `/setup`, observe only `Skip unavailable`, `Re-check`, and disabled `Next`.
- **Fix sketch:** Add a protected Next.js proxy route for setup initialization and a visible primary action in the gate box when config state is uninitialized/missing; refresh setup status/config after success.

### BUG-PROJ2-QA-002 — [Medium] Mobile topbar overlaps navigation and brand
- **File:** `apps/ui/components/Topbar.tsx`
- **Anchor:** `export function Topbar`
- **Source:** Playwright mobile screenshot + Priya Sharma (Performance/UI Runtime)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** At 375x812, the workspace selector, `Setup`/`Settings` nav, and `beerengineer_` brand collide visually. This makes the first-run and settings surfaces look broken on a required mobile viewport.
- **Repro:** Resize browser to 375x812 and capture `/setup` or `/settings`; see `setup-mobile.png` and `settings-mobile.png`.
- **Fix sketch:** Let the topbar wrap or hide the decorative brand at narrow widths; keep nav and workspace controls readable without overlap.

### BUG-PROJ2-QA-003 — [Medium] Secret test failure discards the engine's UI-friendly message
- **File:** `apps/ui/components/settings/SecretMaintenanceRow.tsx`
- **Anchor:** `async function action`
- **Source:** Playwright E2E + Dr. Sarah Chen (Security) + Thomas Mueller (Reliability)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** Clicking `Test` for an active `ANTHROPIC_API_KEY` returns `501` with `{ status: "not_implemented", message: "No secret tester is registered..." }`, but the UI renders only `Secret action failed.` This violates the PRD expectation that explicit test results contain UI-understandable status/error text without cleartext secrets.
- **Repro:** Add an LLM secret on `/settings`, click `Test`, inspect `.playwright-mcp/settings-secret-tested.yml` and `.playwright-mcp/secret-test-501-response.txt`.
- **Fix sketch:** Prefer `body.message`, `body.status`, or known `not_implemented` copy before the generic fallback; keep secret values redacted.

### BUG-PROJ2-QA-004 — [Medium] Recommended gate is labelled Blocked while still allowing Next
- **File:** `apps/ui/components/setup/SetupGateBox.tsx`
- **Anchor:** `const status = checking ? "checking"`
- **Source:** Playwright E2E + Elena Rodriguez (Architecture)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** After required setup passes, the wizard can show the recommended review-tools gate as `Blocked`, with `Skip unavailable`, while `Next` is enabled. The behavior is technically non-blocking, but the vocabulary contradicts the action state and blurs required vs recommended semantics.
- **Repro:** Initialize app state directly, navigate to `/setup`, observe `Review tool recommendations` with `Blocked` and enabled `Next`.
- **QA re-run:** Reproduced after browser `Initialize app` on isolated UI `127.0.0.1:3123`; engine status had `level: "recommended"`, `ideal: true`, and a missing `SONAR_TOKEN` check, so the UI still rendered `Blocked`.
- **Final re-check:** Fixed on isolated UI `127.0.0.1:3133`; after browser `Initialize app`, the review gate showed `Recommended` and `Next` remained enabled.
- **Fix sketch:** Map non-required unsatisfied gates to `Recommended`, `Needs attention`, or `Optional`, and reserve `Blocked` for required gates that disable progression.

### BUG-PROJ2-QA-005 — [Low] Settings status counts read as impossible required totals
- **File:** `apps/ui/components/settings/SetupStatusSection.tsx`
- **Anchor:** `heading "Core app checks"`
- **Source:** Playwright E2E + Ken Takahashi (Minimalism)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** The settings page displayed `Core app checks required · 7/6 required · done`. The numerator is passed checks while the denominator is `minOk`, so the phrase looks like more required checks passed than exist.
- **Repro:** After direct `POST /setup/init`, navigate to `/settings`; inspect `.playwright-mcp/settings-initial.yml`.
- **Fix sketch:** Label the metric as readiness threshold, or show `passed/total` plus a separate required threshold.

### BUG-PROJ2-QA-006 — [Low] Local optional-skip route can report success for non-optional groups
- **File:** `apps/ui/app/api/setup/optional/route.ts`
- **Anchor:** `export async function POST`
- **Source:** API probe + Thomas Mueller (Reliability)
- **Status:** fixed
- **Fix attempts:** 1
- **Description:** The local stub rejects obvious required IDs but returns `{ ok: true, status: "skipped" }` for a recommended group such as `review`, with no engine persistence. The UI currently does not expose that button for recommended gates, but the route contract can still lie to callers.
- **Repro:** `curl -X POST http://127.0.0.1:3113/api/setup/optional -d '{"group":"review"}' -H 'content-type: application/json'`.
- **Fix sketch:** Restrict the route to known optional group IDs and either persist skip state through the engine or name/document it as UI-local only.

## AGENTS.md Candidates

- [MERGED] AGENTS-PROJ2-QA-001: Browser first-run flows must expose UI controls for every PRD-required engine mutation; backend-only success is not enough. — source: Elena Rodriguez (Architecture)
- [MERGED] AGENTS-PROJ2-QA-002: Capture 375px mobile screenshots for every new top-level UI surface before marking a UI wave green. — source: Priya Sharma (Performance/UI Runtime)
- [MERGED] AGENTS-PROJ2-QA-003: When an engine error response includes a redacted user-facing `message`, UI components should display it before falling back to generic copy. — source: Thomas Mueller (Reliability)

## PROJ Retrospective

### Elena Rodriguez (Principal Architect)
- PROJ-2 built the right backend ownership boundary: engine owns setup, config, secrets, and readiness; UI proxies mutations.
- The main integration gap is first-run orchestration. The engine has initialization, but the user-visible wizard does not offer the matching action.
- Recommended/optional gate vocabulary needs a clearer domain model in the UI. Treating every non-ok check as visually blocked makes the state machine harder to trust.
- OpenAPI and prose docs now cover the setup routes, but UI docs still contain stale assumptions about setup initialization and should be reconciled in documentation handoff.
- For PROJ-3, define the browser journey for every backend mutation before wave slicing, not after backend waves pass.

### Ken Takahashi (Minimalism)
- The optional-skip API route is currently a stub with little product value. Either give it real engine state or remove the route until persistence exists.
- The settings status count should be simpler: users need to know whether a group is ready and what failed, not threshold math.
- The secret test UI should not invent generic error language when the engine already sends a safe, specific explanation.
- The topbar is shared chrome; fix it once with responsive behavior rather than patching individual pages.
