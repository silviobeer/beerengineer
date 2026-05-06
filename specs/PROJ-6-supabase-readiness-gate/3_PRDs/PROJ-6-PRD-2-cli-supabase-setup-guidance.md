# PROJ-6-PRD-2: CLI Supabase Setup And Blocked-Run Guidance

## Status: Planned

## User Stories

### US-1: Als CLI Operator moechte ich bei einem blockierten DB-relevanten Run klare Supabase-Aktionen sehen um den naechsten Setup-Schritt zu kennen
**Given** a CLI-started run is DB-relevant and blocked by Supabase readiness  
**When** the CLI reports the blocked state  
**Then** it names the affected workspace and explains that Supabase readiness is required  
**And** it lists all relevant missing actions in one grouped block

**Acceptance Criteria:**
- [ ] AC-1: CLI output includes the workspace key or name for the blocked run.
- [ ] AC-2: CLI output explains that planned DB-relevant waves require Supabase readiness before execution workers start.
- [ ] AC-3: CLI output groups missing actions such as `Store management token`, `Connect Supabase project`, `Create persistent test branch`, `Rotate management token`, or `Re-authorize project access`.
- [ ] AC-4: CLI output provides one primary next command: run the existing setup flow.
- [ ] AC-5: CLI blocked-run output stays concise and does not include the full manual Supabase tutorial every time.

### US-2: Als CLI Operator moechte ich im Setup erfahren was ich manuell in Supabase erledigen muss um Projektregion und Provider-Optionen selbst zu waehlen
**Given** the operator enters CLI setup for a workspace with missing Supabase readiness  
**When** the Supabase setup step is shown  
**Then** the CLI explains that beerengineer does not create the Supabase project  
**And** it provides concise guidance for creating/selecting a project, enabling branching, copying the project ref, and creating a Management API token

**Acceptance Criteria:**
- [ ] AC-6: CLI setup explicitly says the user must create or select the Supabase Cloud project manually.
- [ ] AC-7: CLI setup guidance mentions choosing region/location and provider-side project settings in Supabase.
- [ ] AC-8: CLI setup guidance mentions enabling/checking Supabase branching support for the project or plan.
- [ ] AC-9: CLI setup guidance tells the user to copy the project ref and create a Management API token with project access.
- [ ] AC-10: CLI setup can include useful Supabase links or references without making external browsing mandatory for automated tests.

### US-3: Als CLI Operator moechte ich Project Ref und Management Token im Setup eingeben um die Workspace-Verbindung zu validieren
**Given** the operator has a Supabase project ref and Management API token  
**When** they enter both values in CLI setup  
**Then** beerengineer stores the token through the dedicated Supabase connect/rotate path  
**And** stores the project ref on the selected workspace after validation

**Acceptance Criteria:**
- [ ] AC-11: CLI setup writes `supabase.management_token` only through dedicated Supabase connect/rotate logic, not the generic secret mutation handler.
- [ ] AC-12: The privileged Supabase token ref remains deny-listed from generic `/setup/secrets/<ref>` style mutation.
- [ ] AC-13: CLI setup validates that the token can access the entered project ref before marking the workspace connected.
- [ ] AC-14: The project ref is stored on the selected workspace, not globally and not on a current-workspace guess.
- [ ] AC-15: If validation fails, the previous active token/project metadata remains safe and the redacted provider message is shown before generic fallback copy.

### US-4: Als CLI Operator moechte ich eine persistent test branch erstellen oder anhaengen um DB-relevante Runs starten zu koennen
**Given** the workspace has a validated Supabase project connection  
**When** the operator confirms the persistent test branch setup in CLI setup  
**Then** beerengineer creates or attaches the workspace persistent test branch  
**And** shows progress until it is ready or needs recheck

**Acceptance Criteria:**
- [ ] AC-16: CLI setup offers create or attach behavior for the persistent test branch after token/project validation.
- [ ] AC-17: CLI setup does not create new Supabase projects.
- [ ] AC-18: CLI setup shows `checking` or equivalent progress while branch health is polling interactively.
- [ ] AC-19: CLI setup treats `ACTIVE_HEALTHY` as ready and stores the persistent branch ref/status on the workspace.
- [ ] AC-20: If the interactive branch poll times out or provider state remains transient, CLI setup tells the user to recheck rather than marking execution-ready.

### US-5: Als CLI Operator moechte ich nach Setup denselben Run erneut pruefen um Execution ohne neue Artefakte fortzusetzen
**Given** a Supabase-readiness-blocked run exists  
**When** CLI setup reports the workspace ready  
**Then** the CLI directs the operator to retry the blocked run  
**And** retry reuses the existing blocked run readiness flow

**Acceptance Criteria:**
- [ ] AC-21: CLI setup completion displays a clear retry instruction for the blocked run when run context is available.
- [ ] AC-22: Retrying after setup reuses the existing blocked `runId` semantics from PRD-1.
- [ ] AC-23: If readiness is still incomplete on retry, CLI output shows the updated missing action list.
- [ ] AC-24: CLI setup can also be run outside a blocked-run context to prepare a workspace ahead of time.

## Edge Cases

- User enters a malformed project ref: setup rejects it before storing workspace metadata.
- User enters a token that is syntactically present but lacks project access: setup shows rotate/reauthorize guidance and does not claim ready.
- User starts setup for workspace `beta` after blocking a run in workspace `alpha`: CLI output must identify the mismatch and not imply `alpha` is fixed.
- Branch creation is slow: setup may show checking/recheck, but execution readiness remains blocked until `ACTIVE_HEALTHY`.
- User cancels midway through setup: partial state is not presented as execution-ready.

## Abhaengigkeiten

- Benoetigt: PROJ-6-PRD-1 for readiness payload, blocked-run semantics, and action vocabulary.
- Builds on: existing PROJ-2 setup/secret primitives and PROJ-4 Supabase connect/rotate/persistent branch primitives.
- Blocks: UI PRDs that reuse the same engine setup primitives.

## Technische Anforderungen

- CLI setup is the first production caller for the PROJ-6 readiness model.
- CLI output must be deterministic enough for public CLI acceptance tests.
- Secret values must never be printed.

