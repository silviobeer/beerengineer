# PROJ-5 Wave 2 Implementation Plan

**Goal:** Make `beerengineer setup` launch the real local setup experience while keeping automation deterministic.
**Architecture Reference:** `6_plan/PROJ-5-architecture.md`
**PRDs involved:** PROJ-5-PRD-2

---

## Wave Position

- **Previous waves:** Wave 1 completed - engine Git identity readiness contract available.
- **Next waves:** Wave 3 depends on the interactive setup entry; Wave 4 benefits from the same CLI blocker wording.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-5-PRD-2-US-1 | backend | backend-implementer | opus (process launch/reuse) | Wave 1 complete |
| PROJ-5-PRD-2-US-2 | backend | backend-implementer | opus (headless degradation) | with US-1, same owner |
| PROJ-5-PRD-2-US-3 | backend | backend-implementer | sonnet | Wave 1 complete |
| PROJ-5-PRD-2-US-4 | backend | backend-implementer | sonnet | Wave 1 complete |

All user stories in this wave touch `setupFlow` and CLI launch behavior; keep them in one backend ownership bundle.

---

## PROJ-5-PRD-2-US-1: Als nontechnical User moechte ich mit `beerengineer setup` direkt in die Setup-UI gelangen um ohne Terminalwissen starten zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Interaktives `beerengineer setup` initialisiert fehlende App-Config und DB wie bisher.
- [ ] AC-2: Interaktives `beerengineer setup` startet oder verwendet eine laufende Engine.
- [ ] AC-3: Interaktives `beerengineer setup` startet oder verwendet eine laufende UI.
- [ ] AC-4: Die geoeffnete URL wird aus Runtime/Config ermittelt und nicht hartcodiert.
- [ ] AC-5: Erfolgreicher Browser-Open wird mit der verwendeten URL gemeldet.

### Task 2.1: Interactive Setup Launch Or Reuse
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/cli/ui.ts`
- Modify: `apps/engine/src/setup/types.ts`
- Test: `apps/engine/test/setupInteractiveEntry.test.ts`
- Test: `apps/engine/test/cli.test.ts`

**What to build:** Extend interactive `beerengineer setup` so it preserves existing initialization, detects or starts the engine and UI, discovers the actual setup URL from runtime/config state, opens it when possible, and reports the exact URL used.

**TDD cycle:**
- RED: test initialized-state preservation, engine reuse, UI reuse, non-hardcoded URL discovery, and success message content.
- GREEN: implement launch orchestration with injectable process/opener probes for deterministic tests.
- REFACTOR: keep launch state transient and out of persisted app config.
- COMMIT: `feat(PROJ-5-PRD-2): implement interactive setup launch`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-2-US-2: Als Developer in SSH, CI oder Container moechte ich Setup ohne Browser-Fehler nutzen um die echte Setup-URL manuell oeffnen zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-6: Headless-, CI-, SSH-, Container- oder No-Opener-Situationen degradieren zu "URL drucken".
- [ ] AC-7: Die gedruckte URL ist die tatsaechlich entdeckte URL inklusive Host und Port.
- [ ] AC-8: Engine und UI bleiben verfuegbar, wenn sie erfolgreich gestartet oder gefunden wurden.
- [ ] AC-9: Browser-Open-Fehler wird als recoverable Setup-Hinweis gemeldet, nicht als harter Core-Fehler.

### Task 2.2: Headless Setup Degradation
**Fulfills:** AC-6, AC-7, AC-8, AC-9

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/cli/ui.ts`
- Test: `apps/engine/test/setupInteractiveEntry.test.ts`
- Test: `apps/engine/test/nonInteractivePrompt.test.ts`

**What to build:** Detect no-opener, CI, SSH, container, or browser-open failure states and degrade to printing the discovered URL while leaving successfully started or reused services available.

**TDD cycle:**
- RED: test CI/no display/no opener/open failure cases and assert non-fatal exit behavior.
- GREEN: add recoverable launch hints and service lifetime behavior.
- REFACTOR: make launch result wording reusable by setup and future doctor output.
- COMMIT: `feat(PROJ-5-PRD-2): implement headless setup fallback`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-2-US-3: Als Automation oder Install-Validator moechte ich `setup --no-interactive` ohne UI-Start verwenden um reproduzierbare Checks zu erhalten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-10: `setup --no-interactive` versucht keinen Browser-Open.
- [ ] AC-11: `setup --no-interactive` startet keine interaktive Eingabe fuer Git-Identitaet.
- [ ] AC-12: `setup --no-interactive` kann fehlende Git-Identitaet als actionable readiness melden.
- [ ] AC-13: `setup --no-interactive` bleibt fuer bestehende Install- und Doctor-Tests deterministisch.

### Task 2.3: Non-Interactive Setup Readiness Output
**Fulfills:** AC-10, AC-11, AC-12, AC-13

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/setup/doctorOutput.ts`
- Test: `apps/engine/test/setupInteractiveEntry.test.ts`
- Test: `apps/engine/test/setupStatus.test.ts`
- Test: `apps/engine/test/nonInteractivePrompt.test.ts`

**What to build:** Keep `setup --no-interactive` browser-free and prompt-free while including actionable Git identity readiness from Wave 1 in deterministic setup/doctor output.

**TDD cycle:**
- RED: test no opener calls, no readline prompts, actionable missing-identity status, and stable output for install validators.
- GREEN: gate interactive identity and launch work behind `noInteractive`.
- REFACTOR: keep setup report generation independent from terminal prompts.
- COMMIT: `feat(PROJ-5-PRD-2): preserve noninteractive setup`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-2-US-4: Als CLI User moechte ich App-Level-Git-Identitaet im Terminal speichern koennen um den Engine-first Setup-Pfad vollstaendig zu nutzen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-14: Interaktives CLI-Setup bietet eine Eingabe fuer App-Level-Default-Name und Email.
- [ ] AC-15: CLI-Validierungsfehler sind feldspezifisch und erklaeren die Korrektur.
- [ ] AC-16: Eine gespeicherte CLI-Identitaet erscheint danach im Setup-Readiness-Status.
- [ ] AC-17: CLI-Setup schreibt keine globale Git-Konfiguration.
- [ ] AC-18: CLI-Setup kann aus globaler Git-Identitaet vorbefuellen und trotzdem Edit/Skip erlauben.

### Task 2.4: CLI App Identity Prompt
**Fulfills:** AC-14, AC-15, AC-16, AC-17, AC-18

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Test: `apps/engine/test/setupCliGitIdentity.test.ts`
- Test: `apps/engine/test/gitIdentityConfig.test.ts`

**What to build:** Add an interactive setup prompt for app-level Git identity that uses Wave 1 validation/storage, can prefill from global Git identity, offers edit/skip, writes only beerengineer_ config, and reprints fresh readiness after save.

**TDD cycle:**
- RED: test prompt save, skip, global prefill, field-specific validation errors, and global Git config isolation.
- GREEN: implement prompt flow with injectable readline session for tests.
- REFACTOR: share formatter and validator calls with API output.
- COMMIT: `feat(PROJ-5-PRD-2): implement cli git identity setup`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
