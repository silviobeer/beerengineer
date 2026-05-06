# PROJ-5 Progress

## Status: in progress
## Current Wave: 2
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
- —

### Deferred (user decision)
- —

---

## QA Results

- Bugs found: 0 (Critical: 0, High: 0, Medium: 0, Low: 0)
- Fixed: 0
- Deferred: 0

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
