# PROJ-6-PRD-3: Workspace Supabase Settings

## Status: Planned

## User Stories

### US-1: Als Browser Operator moechte ich Workspace-spezifische Settings oeffnen um Supabase fuer genau diesen Workspace zu konfigurieren
**Given** the operator is working in workspace `alpha`  
**When** they open `/w/alpha/settings#supabase`  
**Then** the page renders workspace settings for `alpha`  
**And** Supabase setup uses server-side workspace resolution from the route key

**Acceptance Criteria:**
- [ ] AC-1: A new workspace settings route exists at `/w/:key/settings`.
- [ ] AC-2: The route is a sibling of the existing `/w/:key` workspace board and uses the workspace shell/topbar pattern.
- [ ] AC-3: The Supabase section is reachable via `#supabase`.
- [ ] AC-4: The section navigation is forward-compatible for later workspace settings sections without requiring additional sections in PROJ-6.
- [ ] AC-5: The engine resolves workspace metadata from the workspace key server-side; browser-supplied paths/project refs/branch refs are not authoritative.
- [ ] AC-6: The `/w/:key/settings` route never trusts a body-provided workspace id over the route key/server-resolved workspace.
- [ ] AC-7: Opening settings for workspace `beta` cannot configure or unblock a run for workspace `alpha`.

### US-2: Als Browser Operator moechte ich die benoetigten Supabase-Werte direkt sehen und einfuegen koennen um Setup ohne versteckte Wizard-Schritte abzuschliessen
**Given** the workspace is not Supabase-ready  
**When** the operator views the Supabase section  
**Then** the setup inputs are visible on the scannable settings page  
**And** the page shows what each pasted value is used for

**Acceptance Criteria:**
- [ ] AC-8: The page visibly provides a Supabase project ref input.
- [ ] AC-9: The page visibly provides a Supabase Management API token input or token replace/rotate control.
- [ ] AC-10: The page visibly provides a persistent test branch create/attach choice after project/token validation is available.
- [ ] AC-11: The token input uses the dedicated Supabase connect/rotate path and not a generic secret mutation route.
- [ ] AC-12: The not-configured state renders a stub plus setup inputs; it does not render the full connected cleanup/protection control set.

### US-3: Als Browser Operator moechte ich Readiness-Zustand und fehlende Aktionen auf einen Blick sehen um zu wissen was noch fehlt
**Given** the workspace has incomplete Supabase readiness  
**When** the Supabase settings section loads or rechecks readiness  
**Then** it shows a readiness summary and checklist  
**And** it lists all relevant missing setup actions using the engine readiness payload

**Acceptance Criteria:**
- [ ] AC-13: The readiness summary shows blocked/ready/checking/error state for the selected workspace.
- [ ] AC-14: Missing token, missing project ref, missing branch, invalid token, and unauthorized-project states use exactly the PRD-1 missing setup action labels.
- [ ] AC-15: `Retry run` is shown only as a separate blocked-run affordance when run context exists, not as a missing setup action.
- [ ] AC-16: Invalid/revoked/HTTP 401 token failures show `Rotate management token`; HTTP 403 permission-denied project access failures show `Re-authorize project access`.
- [ ] AC-17: The UI displays redacted provider `message` text before generic fallback copy when the engine returns one.
- [ ] AC-18: The UI can show `checking` during setup/settings recheck while branch health is polling.
- [ ] AC-19: The UI does not mark the workspace ready until the engine reports `ACTIVE_HEALTHY` branch readiness.

### US-4: Als Browser Operator moechte ich nach erfolgreichem Setup den blockierten Run erneut starten koennen um Arbeit fortzusetzen
**Given** a blocked run linked the operator to workspace settings  
**When** readiness becomes ready in the settings page  
**Then** the page enables a retry affordance for the same blocked run when run context is available  
**And** retry re-enters the existing blocked run

**Acceptance Criteria:**
- [ ] AC-20: Retry is disabled or absent while readiness remains blocked/checking.
- [ ] AC-21: Retry becomes available after the engine reports ready and run context is known.
- [ ] AC-22: Retry uses the existing blocked `runId` semantics from PRD-1 rather than creating a new normal run.
- [ ] AC-23: If no blocked-run context is available, the page still allows setup/recheck but does not show a misleading retry action.
- [ ] AC-24: If retry still blocks, the UI refreshes the missing setup action list instead of claiming success.

### US-5: Als Browser Operator moechte ich die Supabase Settings auf Desktop und Mobile benutzen koennen um lokale Workflows auch auf schmalen Screens zu reparieren
**Given** the operator uses the workspace Supabase settings page on desktop or 375px mobile width  
**When** they review readiness and enter setup values  
**Then** the layout remains usable without hidden required inputs or horizontal scrolling  
**And** existing app design patterns are preserved

**Acceptance Criteria:**
- [ ] AC-25: At 375px width, project ref, token, persistent branch choice, recheck, and retry controls remain visible and usable.
- [ ] AC-26: The workspace settings section nav stacks above content on narrow screens.
- [ ] AC-27: The UI reuses existing dark operator-console tokens and square bordered panel language.
- [ ] AC-28: Important UI elements use or are traceable to accepted reuse/new component candidates from the implementation handoff.
- [ ] AC-29: New top-level workspace settings UI has a 375px screenshot captured before QA can mark the UI wave green.

## Edge Cases

- Engine is unreachable: the workspace settings page shows an engine-unreachable error without losing the workspace key context.
- Workspace key does not exist: the existing unknown-workspace guard or equivalent prevents editing.
- Token is present but unauthorized for this project: show rotate/reauthorize action, not store-token action.
- Persistent branch is transient: settings may keep checking/rechecking while execution remains blocked until ready.
- User pastes values in the wrong workspace settings page: only that route's workspace is mutated.

## Abhaengigkeiten

- Benoetigt: PROJ-6-PRD-1 readiness contract and blocked-run retry semantics.
- Benoetigt: PROJ-6-PRD-2 engine setup/connect/rotate/persistent branch primitives.
- Related: PROJ-6-PRD-4 provides the board entry point into this page.

## UI Implementation Notes

- Project mode: brownfield.
- Reuse: `Topbar`, `/w/[key]` workspace shell, `AppSettingsPage` layout pattern, `StatusChip`, `SupabaseSettingsSection`, `SupabaseSetupCard`, `SecretMaintenanceRow`, `BranchLifecycleStepper`, `DestroyConfirmDialog`.
- New component candidates: `WorkspaceSettingsPage`, `SupabaseReadinessSummary`.
- Design tokens: use `bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`, `text-zinc-100`, `text-zinc-400`, amber warning utilities, emerald/petrol success utilities, `font-display`, and `font-mono`.
- Interaction contract: scannable workspace settings page at `/w/:key/settings#supabase`; visible paste inputs; not-configured stub; readiness recheck; retry only after ready.
- Implementation tolerance: mockups are structural, not pixel-perfect; existing React components and tokens take precedence; manual Supabase guidance may be collapsible or linked if paste inputs remain visible.

## QA Test Results

**Tested:** 2026-05-06  
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

- AC-1 through AC-29: PASS for the main settings flow in browser/API QA and UI regression tests.
- Browser evidence: `/w/alpha/settings#supabase` rendered workspace-scoped settings with project ref input, Management API token input, readiness summary, missing setup actions, branch create/attach choice, and disabled branch/retry controls while blocked.
- Responsive evidence: 375px, 768px, and 1440px screenshots captured.

### Edge Cases Status

- Missing token/project/branch summary: PASS.
- Malformed project-ref/XSS payload did not execute in the browser; direct proxy returned safe JSON error for missing token.
- Deep-link behavior: FAIL usability polish; hash target lands partly under topbar.

### Security Audit Results

- [ ] BUG-PROJ6-QA-001: Next.js Supabase mutation proxies bypass the engine CSRF gate before forwarding engine tokens.
- [x] Direct engine endpoints still enforce CSRF.
- [x] No Supabase token value appeared in inspected readiness/board API responses.

### Bugs Found

- BUG-PROJ6-QA-001 — Critical — Next.js Supabase mutation proxies bypass the engine CSRF gate.
- BUG-PROJ6-QA-002 — Critical — PROJ-6 UI components are missing from the component registry.
- BUG-PROJ6-QA-003 — Medium — `/w/:key/settings#supabase` lands under the sticky topbar.
- BUG-PROJ6-QA-005 — Low — New blocker UI uses arbitrary font-size utilities outside the scale.

### Summary

- **Acceptance Criteria:** 29/29 functionally passed, with one Medium deep-link polish bug.
- **Bugs Found:** 4 relevant (2 Critical, 1 Medium, 1 Low).
- **Security:** Issues found.
- **Production Ready:** NO.
