# PROJ-2 Progress

## Status: in progress
## Current Wave: 5
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
