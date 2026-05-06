# PROJ-6 Wave 4 Implementation Plan

**Goal:** Build the workspace-specific Supabase settings repair surface using the shared engine readiness/setup contract.
**Architecture Reference:** `6_plan/PROJ-6-architecture.md`
**PRDs involved:** PROJ-6-PRD-3

---

## Wave Position

- **Previous waves:** Wave 3 - CLI setup and engine setup primitives complete.
- **Next waves:** Wave 5 depends on `/w/:key/settings#supabase` as the board blocker repair destination.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-6-PRD-3-US-1 | full-stack | fullstack-implementer | opus (workspace route authority) | after Wave 3 |
| PROJ-6-PRD-3-US-2 | full-stack | fullstack-implementer | sonnet | after PRD-3-US-1 |
| PROJ-6-PRD-3-US-3 | full-stack | fullstack-implementer | sonnet | after PRD-3-US-1 |
| PROJ-6-PRD-3-US-4 | full-stack | fullstack-implementer | sonnet | after PRD-3-US-3 |
| PROJ-6-PRD-3-US-5 | frontend | frontend-implementer | sonnet | after PRD-3-US-2 and PRD-3-US-3 |

Stories in this wave share UI components and proxy routes; coordinate ownership of `WorkspaceSettingsPage` and `SupabaseReadinessSummary`.

---

## PROJ-6-PRD-3-US-1: Als Browser Operator moechte ich Workspace-spezifische Settings oeffnen um Supabase fuer genau diesen Workspace zu konfigurieren
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-1: A new workspace settings route exists at `/w/:key/settings`.
- [ ] AC-2: The route is a sibling of the existing `/w/:key` workspace board and uses the workspace shell/topbar pattern.
- [ ] AC-3: The Supabase section is reachable via `#supabase`.
- [ ] AC-4: The section navigation is forward-compatible for later workspace settings sections without requiring additional sections in PROJ-6.
- [ ] AC-5: The engine resolves workspace metadata from the workspace key server-side; browser-supplied paths/project refs/branch refs are not authoritative.
- [ ] AC-6: The `/w/:key/settings` route never trusts a body-provided workspace id over the route key/server-resolved workspace.
- [ ] AC-7: Opening settings for workspace `beta` cannot configure or unblock a run for workspace `alpha`.

**Smoke Test:**
- Route: `/w/alpha/settings#supabase`
- Verify: "The page renders inside the workspace shell, names workspace alpha, shows a Supabase settings section, and does not show a generic app-global settings repair destination."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workspace-supabase-settings.html`
- Selected direction: scannable workspace settings page at `/w/:key/settings#supabase`.
- Reuse: `Topbar`, `/w/[key]` workspace shell, `AppSettingsPage` settings layout pattern, `StatusChip`.
- Create new: `WorkspaceSettingsPage` for workspace-scoped settings shell.
- Design tokens: `bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`, `text-zinc-100`, `text-zinc-400`, amber warnings, emerald/petrol success, `font-display`, `font-mono`.
- Interaction contract: server resolves workspace from route key; no app-global current-workspace guessing.
- Implementation tolerance: existing React components and design tokens take precedence over exact HTML mockup CSS; preserve selected layout direction.

### Task 4.1: Workspace Settings Route And Server Resolution
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

**Files:**
- Create: `apps/ui/app/w/[key]/settings/page.tsx`
- Create: `apps/ui/components/settings/WorkspaceSettingsPage.tsx`
- Create: `apps/ui/app/api/workspaces/[key]/supabase/readiness/route.ts`
- Modify: `apps/ui/lib/engine/proxy.ts`
- Modify: `apps/engine/src/api/routes/workspaces.ts`
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Test: `apps/ui/tests/workspaceSettingsPage.test.tsx`
- Test: `apps/engine/test/api/routes/workspaceSupabaseReadiness.test.ts`

**What to build:** Add the workspace settings route, server-side workspace-key resolution, and readiness read proxy without trusting body-provided workspace/project/branch authority.

**Components (UI tasks only - mandatory):**
- Reuse: `Topbar`, workspace route provider/SSE shell, `AppSettingsPage` layout language, `StatusChip`.
- Create new: `WorkspaceSettingsPage` - app settings is global; workspace settings needs route-key identity and workspace-scoped nav.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: scannable workspace settings page at `/w/:key/settings#supabase`.
- May approximate: exact spacing from HTML mockup.
- Must not change without user approval: workspace settings as the browser repair surface.

**TDD cycle:**
- RED: UI route test verifies workspace shell/anchor; engine API test verifies beta request/body cannot mutate alpha.
- GREEN: implement route, proxy, and engine contract.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-3): implement workspace settings route`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-3-US-2: Als Browser Operator moechte ich die benoetigten Supabase-Werte direkt sehen und einfuegen koennen um Setup ohne versteckte Wizard-Schritte abzuschliessen
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-8: The page visibly provides a Supabase project ref input.
- [ ] AC-9: The page visibly provides a Supabase Management API token input or token replace/rotate control.
- [ ] AC-10: The page visibly provides a persistent test branch create/attach choice after project/token validation is available.
- [ ] AC-11: The token input uses the dedicated Supabase connect/rotate path and not a generic secret mutation route.
- [ ] AC-12: The not-configured state renders a stub plus setup inputs; it does not render the full connected cleanup/protection control set.

**Smoke Test:**
- Route: `/w/alpha/settings#supabase`
- Verify: "When Supabase is not configured, project ref and token inputs are visible, connected-only cleanup/protection controls are hidden, and persistent branch choices appear after validation is available."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workspace-supabase-settings.html`
- Selected direction: visible setup inputs on the settings page, not hidden in a wizard.
- Reuse: `SupabaseSetupCard`, `SecretMaintenanceRow`, `SupabaseSettingsSection` pieces where extractable.
- Create new: no additional component beyond `WorkspaceSettingsPage` unless extraction from app settings requires a workspace-scoped subcomponent.
- Design tokens: same dark settings panel language.
- Interaction contract: token writes use dedicated Supabase connect/rotate paths.
- Implementation tolerance: manual Supabase guidance may be collapsible if paste inputs remain visible.

### Task 4.2: Visible Workspace Supabase Inputs
**Fulfills:** AC-8, AC-9, AC-10, AC-11, AC-12

**Files:**
- Create: `apps/ui/components/settings/SupabaseReadinessSummary.tsx`
- Modify: `apps/ui/components/settings/SupabaseSettingsSection.tsx`
- Create: `apps/ui/app/api/workspaces/[key]/supabase/connect/route.ts`
- Create: `apps/ui/app/api/workspaces/[key]/supabase/rotate/route.ts`
- Create: `apps/ui/app/api/workspaces/[key]/supabase/branch/route.ts`
- Modify: `apps/engine/src/api/routes/workspaces.ts`
- Test: `apps/ui/tests/workspaceSupabaseSettings.test.tsx`
- Test: `apps/engine/test/api/routes/workspaceSupabaseSetup.test.ts`

**What to build:** Render the not-configured stub plus visible project ref, token, and persistent branch setup inputs, and connect those inputs to dedicated workspace Supabase setup endpoints.

**Components (UI tasks only - mandatory):**
- Reuse: `SupabaseSetupCard`, `SecretMaintenanceRow`, `StatusChip`, `BranchLifecycleStepper`.
- Create new: `SupabaseReadinessSummary` - readiness/missing-action summary is shared by workspace settings and later board blocker semantics.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: setup inputs visible on the scannable page.
- May approximate: exact copy length for manual guidance.
- Must not change without user approval: no wizard as primary setup container.

**TDD cycle:**
- RED: UI test verifies visible inputs and hidden connected controls in not-configured state; API test verifies dedicated token path.
- GREEN: implement UI form and proxy/engine mutations.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-3): implement workspace supabase inputs`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-3-US-3: Als Browser Operator moechte ich Readiness-Zustand und fehlende Aktionen auf einen Blick sehen um zu wissen was noch fehlt
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-13: The readiness summary shows blocked/ready/checking/error state for the selected workspace.
- [ ] AC-14: Missing token, missing project ref, missing branch, invalid token, and unauthorized-project states use exactly the PRD-1 missing setup action labels.
- [ ] AC-15: `Retry run` is shown only as a separate blocked-run affordance when run context exists, not as a missing setup action.
- [ ] AC-16: Invalid/revoked/HTTP 401 token failures show `Rotate management token`; HTTP 403 permission-denied project access failures show `Re-authorize project access`.
- [ ] AC-17: The UI displays redacted provider `message` text before generic fallback copy when the engine returns one.
- [ ] AC-18: The UI can show `checking` during setup/settings recheck while branch health is polling.
- [ ] AC-19: The UI does not mark the workspace ready until the engine reports `ACTIVE_HEALTHY` branch readiness.

**Smoke Test:**
- Route: `/w/alpha/settings#supabase`
- Verify: "The readiness summary lists missing setup actions, shows checking/error/ready states from the engine, and keeps retry visually separate."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workspace-supabase-settings.html`
- Selected direction: top-of-section readiness summary.
- Reuse: `StatusChip`, `BranchLifecycleStepper`, amber inline warnings.
- Create new: `SupabaseReadinessSummary`.
- Design tokens: amber blocked/error, emerald ready, mono identifiers.
- Interaction contract: render engine readiness snapshot instead of deriving readiness locally.
- Implementation tolerance: provider copy may vary but redacted provider message appears before fallback copy.

### Task 4.3: Workspace Readiness Summary
**Fulfills:** AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19

**Files:**
- Modify: `apps/ui/components/settings/SupabaseReadinessSummary.tsx`
- Modify: `apps/ui/lib/engine/types.ts`
- Modify: `apps/ui/lib/setup/types.ts`
- Test: `apps/ui/tests/workspaceSupabaseReadinessSummary.test.tsx`

**What to build:** Render blocked/ready/checking/error state, exact missing setup labels, auth label distinctions, redacted provider messages, and `ACTIVE_HEALTHY`-only ready state from the engine payload.

**Components (UI tasks only - mandatory):**
- Reuse: `StatusChip`, `BranchLifecycleStepper`.
- Create new: `SupabaseReadinessSummary` - no existing component owns the combined missing-action and retry affordance shape.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: readiness summary plus checklist stays visible.
- May approximate: exact order of non-critical status facts.
- Must not change without user approval: retry remains separate from setup actions.

**TDD cycle:**
- RED: component tests cover all readiness states and exact labels.
- GREEN: implement summary rendering.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-3): implement supabase readiness summary`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-3-US-4: Als Browser Operator moechte ich nach erfolgreichem Setup den blockierten Run erneut starten koennen um Arbeit fortzusetzen
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-20: Retry is disabled or absent while readiness remains blocked/checking.
- [ ] AC-21: Retry becomes available after the engine reports ready and run context is known.
- [ ] AC-22: Retry uses the existing blocked `runId` semantics from PRD-1 rather than creating a new normal run.
- [ ] AC-23: If no blocked-run context is available, the page still allows setup/recheck but does not show a misleading retry action.
- [ ] AC-24: If retry still blocks, the UI refreshes the missing setup action list instead of claiming success.

**Smoke Test:**
- Route: `/w/alpha/settings#supabase`
- Verify: "Retry is disabled while blocked/checking, appears only with a ready run context, and refreshes the action list if the retry remains blocked."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workspace-supabase-settings.html`
- Selected direction: retry affordance inside workspace settings after readiness is ready.
- Reuse: `SupabaseReadinessSummary`, existing proxy mutation helpers.
- Create new: no extra component unless `SupabaseReadinessSummary` owns retry rendering.
- Design tokens: existing amber/emerald button language.
- Interaction contract: retry re-enters same blocked run and does not create a new run.
- Implementation tolerance: success-state jump button in mockup is demo-only.

### Task 4.4: Workspace Settings Retry Flow
**Fulfills:** AC-20, AC-21, AC-22, AC-23, AC-24

**Files:**
- Modify: `apps/ui/components/settings/SupabaseReadinessSummary.tsx`
- Create: `apps/ui/app/api/runs/[id]/supabase-readiness/retry/route.ts`
- Modify: `apps/engine/src/api/routes/runs.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Test: `apps/ui/tests/workspaceSupabaseRetry.test.tsx`
- Test: `apps/engine/test/api/routes/supabaseReadinessRetry.test.ts`

**What to build:** Add same-run retry from workspace settings, disabled/absent states for blocked/checking/no-run-context, and refresh behavior for still-blocked retry responses.

**Components (UI tasks only - mandatory):**
- Reuse: `SupabaseReadinessSummary`, `StatusChip`.
- Create new: none; retry is part of the readiness summary contract.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: retry disabled until readiness is ready.
- May approximate: exact success button copy.
- Must not change without user approval: same-run retry semantics.

**TDD cycle:**
- RED: tests verify retry visibility, same-run endpoint use, and still-blocked refresh.
- GREEN: implement retry proxy and UI behavior.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-3): implement workspace supabase retry`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-3-US-5: Als Browser Operator moechte ich die Supabase Settings auf Desktop und Mobile benutzen koennen um lokale Workflows auch auf schmalen Screens zu reparieren
**Scope:** frontend -> frontend-implementer

**Acceptance Criteria:**
- [ ] AC-25: At 375px width, project ref, token, persistent branch choice, recheck, and retry controls remain visible and usable.
- [ ] AC-26: The workspace settings section nav stacks above content on narrow screens.
- [ ] AC-27: The UI reuses existing dark operator-console tokens and square bordered panel language.
- [ ] AC-28: Important UI elements use or are traceable to accepted reuse/new component candidates from the implementation handoff.
- [ ] AC-29: New top-level workspace settings UI has a 375px screenshot captured before QA can mark the UI wave green.

**Smoke Test:**
- Route: `/w/alpha/settings#supabase`
- Verify: "At 375px width, inputs, recheck, and retry are visible without horizontal scrolling."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workspace-supabase-settings.html`
- Selected direction: dense workspace settings page, not marketing layout.
- Reuse: `Topbar`, workspace shell, settings nav, `StatusChip`.
- Create new: `WorkspaceSettingsPage`, `SupabaseReadinessSummary`.
- Design tokens: existing zinc/amber/emerald theme and square panels.
- Interaction contract: nav stacks above content on narrow screens.
- Implementation tolerance: mockups are structural, not pixel-perfect.

### Task 4.5: Responsive Workspace Settings Polish
**Fulfills:** AC-25, AC-26, AC-27, AC-28, AC-29

**Files:**
- Modify: `apps/ui/components/settings/WorkspaceSettingsPage.tsx`
- Modify: `apps/ui/components/settings/SupabaseReadinessSummary.tsx`
- Test: `apps/ui/tests/workspaceSupabaseSettings.test.tsx`

**What to build:** Ensure the workspace settings route uses existing dark operator-console tokens, stacks navigation on mobile, avoids horizontal scrolling, and has a 375px smoke path ready for QA screenshot capture.

**Components (UI tasks only - mandatory):**
- Reuse: `Topbar`, `StatusChip`, `AppSettingsPage` layout pattern.
- Create new: `WorkspaceSettingsPage` and `SupabaseReadinessSummary` as already introduced in this wave.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: no card-within-card decoration, square bordered panels, required inputs visible.
- May approximate: exact HTML mockup spacing.
- Must not change without user approval: `/w/:key/settings#supabase` as repair container.

**TDD cycle:**
- RED: responsive render test verifies key controls are present and no layout-only text fallback hides required controls.
- GREEN: implement responsive layout polish.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-3): polish workspace supabase settings`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
