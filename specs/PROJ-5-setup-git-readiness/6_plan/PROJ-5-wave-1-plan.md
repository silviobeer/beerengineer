# PROJ-5 Wave 1 Implementation Plan

**Goal:** Deliver the engine-owned Git identity readiness, validation, app-default, and workspace repair contract.
**Architecture Reference:** `6_plan/PROJ-5-architecture.md`
**PRDs involved:** PROJ-5-PRD-1

---

## Wave Position

- **Previous waves:** None.
- **Next waves:** Wave 2, Wave 3, Wave 4 depend on this wave's shared engine contract.

## Dependency Analysis

PROJ-5 is intentionally engine-first for implementation. The dependency order is:

1. **Wave 1:** PROJ-5-PRD-1-US-1 through US-5 build the canonical engine contract, shared validator, app config storage, API surface, and server-side workspace repair.
2. **Wave 2:** PROJ-5-PRD-2-US-1 through US-4 reuse Wave 1 from CLI setup and setup launch.
3. **Wave 3:** PROJ-5-PRD-3-US-1 through US-5 consume the Wave 1 API contract from the setup UI.
4. **Wave 4:** PROJ-5-PRD-4-US-1 through US-5 add workflow-start gating after the readiness contract and repair contract are stable.

Wave 1 stories share the same canonical module and OpenAPI contract. Execute them as one backend ownership bundle or coordinate commits carefully; do not let parallel workers publish duplicate readiness types, validators, or error enums.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-5-PRD-1-US-1 | backend | backend-implementer | opus (canonical cross-surface contract) | immediately |
| PROJ-5-PRD-1-US-2 | backend | backend-implementer | opus (Git precedence and workspace mode) | after canonical types exist |
| PROJ-5-PRD-1-US-3 | backend | backend-implementer | sonnet | after validator types exist |
| PROJ-5-PRD-1-US-4 | backend | backend-implementer | sonnet | immediately |
| PROJ-5-PRD-1-US-5 | backend | backend-implementer | opus (filesystem safety boundary) | after workspace readiness exists |

All user stories in this wave share backend ownership; keep implementation serialized inside this wave to avoid type drift.

**Complexity column - classification rule:**
- **`sonnet`**: standard feature US.
- **`opus`**: architecture-sensitive contracts, filesystem safety, concurrency, or expensive-to-undo state shape.

---

## PROJ-5-PRD-1-US-1: Als Developer auf einer frischen Maschine moechte ich Git-Identity-Readiness als Status sehen um fehlende Git-Konfiguration vor einem Workflow zu erkennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Der globale Readiness-Modus meldet Git-Installation, globale `user.name`, globale `user.email`, App-Level-Default-Name, App-Level-Default-Email und verfuegbare globale Aktionen.
- [ ] AC-2: Wenn Git installiert ist, aber keine globale und keine App-Level-Identitaet existiert, ist Setup nicht kaputt, aber Workflow-Readiness ist blockiert.
- [ ] AC-3: Der globale Status unterscheidet fehlendes Git von fehlender Git-Identitaet.
- [ ] AC-4: Der Status enthaelt keine rohen Secrets oder Tokens.

### Task 1.1: Canonical Global Readiness Snapshot
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Create: `apps/engine/src/setup/gitIdentity.ts`
- Modify: `apps/engine/src/setup/types.ts`
- Modify: `apps/engine/src/setup/doctor.ts`
- Test: `apps/engine/test/gitIdentityReadiness.test.ts`
- Test: `apps/engine/test/setupStatus.test.ts`

**What to build:** Add the canonical Git identity domain with global readiness mode, including Git installation state, global identity fields, app-level default fields, source labels, workflow blocker state, and non-secret-safe serialization.

**TDD cycle:**
- RED: test that global readiness distinguishes missing Git from missing identity and never includes token-like config fields.
- GREEN: implement the minimal domain functions and setup status integration.
- REFACTOR: keep exported types and helpers in `apps/engine/src/setup/gitIdentity.ts`; avoid duplicate type exports elsewhere.
- COMMIT: `feat(PROJ-5-PRD-1): implement global git readiness`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-1-US-2: Als Existing Repo User moechte ich sehen, welche Identitaet ein Workspace verwenden wuerde um bestehende Repo-Konfiguration nicht zu ueberschreiben
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: Workspace-Readiness meldet, ob der registrierte Workspace ein Git-Repo ist.
- [ ] AC-6: Repo-local `user.name` und `user.email` gewinnen vor globaler und App-Level-Identitaet.
- [ ] AC-7: Wenn repo-local fehlt, aber globale Identitaet vollstaendig ist, ist der Workspace ready.
- [ ] AC-8: Wenn repo-local und global fehlen, aber App-Level-Default existiert, meldet der Status eine anwendbare Workspace-Repair-Aktion statt sofortiger Ready-State.
- [ ] AC-9: Wenn alle Identitaetsquellen fehlen, meldet der Status einen Workflow-Blocker mit Reparaturhinweis.

### Task 1.2: Workspace Readiness Precedence
**Fulfills:** AC-5, AC-6, AC-7, AC-8, AC-9

**Files:**
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Modify: `apps/engine/src/types/workspace.ts`
- Test: `apps/engine/test/gitIdentityReadiness.test.ts`
- Test: `apps/engine/test/workspaces.test.ts`

**What to build:** Add workspace readiness mode that resolves a registered workspace, detects whether it is a Git repository, reads repo-local and global Git identity with isolated Git environment handling in tests, and applies precedence `repo-local -> global -> app-level repair available -> blocked`.

**TDD cycle:**
- RED: test temp repos with repo-local identity, global-only identity, app-default-only identity, no identity, and non-Git workspace states.
- GREEN: implement workspace snapshot and source selection.
- REFACTOR: keep Git CLI calls behind small helpers that accept cwd/env so tests remain hermetic.
- COMMIT: `feat(PROJ-5-PRD-1): implement workspace git readiness`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-1-US-3: Als Operator moechte ich eine beerengineer_-Default-Identitaet speichern um neue verwaltete Workspaces ohne globale Git-Konfiguration nutzen zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-10: Die App-Level-Identitaet enthaelt Display Name, Email und `localOnly`.
- [ ] AC-11: Das Speichern der App-Level-Identitaet schreibt keine Werte nach `git config --global`.
- [ ] AC-12: Eine gespeicherte App-Level-Identitaet erscheint im globalen Setup-Status.
- [ ] AC-13: Private Placeholder-Emails setzen `localOnly: true`.
- [ ] AC-14: Realistische oder GitHub-noreply-Emails koennen `localOnly: false` sein.

### Task 1.3: App-Level Identity Config
**Fulfills:** AC-10, AC-11, AC-12, AC-13, AC-14

**Files:**
- Modify: `apps/engine/src/setup/types.ts`
- Modify: `apps/engine/src/setup/config.ts`
- Modify: `apps/engine/src/setup/appConfigView.ts`
- Modify: `apps/engine/src/setup/appConfigPatch.ts`
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Test: `apps/engine/test/gitIdentityConfig.test.ts`
- Test: `apps/engine/test/appConfigPatch.test.ts`
- Test: `apps/engine/test/appConfigView.test.ts`

**What to build:** Store `gitIdentityDefault` in beerengineer_ app config with `displayName`, `email`, and `localOnly`, expose it in config views/status, validate it through the shared validator, and never call `git config --global`.

**TDD cycle:**
- RED: test saving, reading, validation failure, local-only derivation, and global Git config isolation.
- GREEN: add config schema fields, patch handling, view projection, and status integration.
- REFACTOR: centralize read-after-write behavior so concurrent edits show the post-save disk state.
- COMMIT: `feat(PROJ-5-PRD-1): implement app git identity default`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-1-US-4: Als CLI/API Consumer moechte ich eine gemeinsame Email-Validierung nutzen um Setup-Ergebnisse in CLI und UI konsistent zu halten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-15: CLI, API und UI verwenden dieselbe Validierungslogik oder denselben serverseitigen Validator.
- [ ] AC-16: Der Validator akzeptiert strukturell gueltige `local@domain` Formen.
- [ ] AC-17: Der Validator erkennt `@local.beerengineer` als privaten lokalen Placeholder.
- [ ] AC-18: Der Validator erkennt GitHub-noreply-Formen als publishing-taugliche Option.
- [ ] AC-19: Ungueltige Eingaben liefern feldspezifische Fehlermeldungen fuer Display Name oder Email.

### Task 1.4: Shared Identity Validator And Error Vocabulary
**Fulfills:** AC-15, AC-16, AC-17, AC-18, AC-19

**Files:**
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Modify: `apps/engine/src/setup/types.ts`
- Test: `apps/engine/test/gitIdentityValidation.test.ts`

**What to build:** Add one server-side validator for display name and email, returning field-specific errors and the shared error codes from architecture: `git_not_installed`, `identity_missing`, `identity_invalid`, `workspace_not_found`, `workspace_not_git_repo`, `workspace_path_unavailable`, `repair_partial_failure`, and `commit_signing_blocked`.

**TDD cycle:**
- RED: test valid real emails, `@local.beerengineer`, GitHub noreply patterns, blank display names, malformed emails, and field-specific error objects.
- GREEN: implement validator and exported types from the canonical module.
- REFACTOR: remove any duplicated ad hoc email logic introduced during the wave.
- COMMIT: `feat(PROJ-5-PRD-1): implement git identity validation`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-1-US-5: Als Security-conscious Operator moechte ich Workspace-Reparaturen nur gegen registrierte Server-State-Pfade ausfuehren um Path-Injection zu verhindern
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-20: Workspace-Reparatur nimmt eine Workspace-ID oder einen Workspace-Key entgegen, aber keinen vertrauenswuerdigen Root-Pfad.
- [ ] AC-21: Der Engine-Code loest den Workspace-Root serverseitig aus der Workspace-Registry auf.
- [ ] AC-22: Request-Body-Felder wie `path`, `rootPath` oder `workspaceRoot` werden bei Reparaturaktionen ignoriert oder abgelehnt.
- [ ] AC-23: Ein unbekannter Workspace fuehrt zu einem klaren `workspace_not_found` Fehler ohne Git-Nebenwirkungen.

### Task 1.5: Workspace Repair API
**Fulfills:** AC-20, AC-21, AC-22, AC-23

**Files:**
- Create: `apps/engine/src/api/routes/gitIdentity.ts`
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Modify: `docs/api-contract.md`
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Test: `apps/engine/test/gitIdentityRepair.test.ts`
- Test: `apps/engine/test/gitIdentityApi.test.ts`

**What to build:** Add Engine API endpoints for global readiness, workspace readiness, app-default save, and workspace repair. Repair accepts only workspace identifier and identity data, resolves the root from `Repos`, writes `user.name` and `user.email` as repo-local config sequentially after validation, then returns a fresh readiness snapshot including partial failure state.

**TDD cycle:**
- RED: test unknown workspace, injected `path`/`rootPath`/`workspaceRoot` body fields, partial write simulation, fresh recheck after repair, and OpenAPI route shape.
- GREEN: implement route handlers, server registration, canonical responses, and OpenAPI/docs updates.
- REFACTOR: keep path resolution helpers shared with workflow-start code where practical.
- COMMIT: `feat(PROJ-5-PRD-1): implement workspace git repair API`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
