# PROJ-6 Visual Companion - Supabase Readiness Gate

## Existing UI Patterns

- `Topbar` (`apps/ui/components/Topbar.tsx`) is the shared sticky header for workspace, setup, and settings surfaces. It includes `WorkspaceSwitcher`, app navigation, and the `beerengineer_` brand marker.
- `/w/[key]` already has a workspace layout with `WorkspaceProvider`, `SSEConnectionManager`, `Topbar`, and `UnknownWorkspaceGuard`. A workspace settings route can be a sibling under this route tree.
- `/settings` uses `AppSettingsPage`: a two-column settings layout with a 220px section nav and dense content sections.
- Existing settings primitives include `SetupStatusSection`, `AppConfigSection`, `SecretMaintenanceRow`, `PartialSaveSummary`, and `SupabaseSettingsSection`.
- Existing Supabase UI candidates include `SupabaseSettingsSection`, `BranchLifecycleStepper`, `DestroyConfirmDialog`, `PlanLimitBanner`, `RetainedBranchBanner`, and `SupabaseSetupCard`.
- Status vocabulary should reuse `StatusChip`, amber inline warnings, and emerald/petrol success output.
- Visual language is a dark operator console: `bg-zinc-950`, `border-zinc-800`, `bg-zinc-900`, amber warnings, petrol/emerald success, `font-display` headings, and `font-mono` identifiers.

## Project Mode

- Mode: brownfield
- Evidence: the UI already has workspace routes, a workspace shell, app settings, setup surfaces, Supabase settings components, status chips, and documented component reuse patterns.
- Design/component gaps: there is no workspace-specific settings route yet; no dedicated blocked-run Supabase recovery panel exists; the existing Supabase settings section is app-settings/current-workspace oriented and needs explicit workspace binding.

## Layout Decision To Make

- Should workspace Supabase setup be a scannable settings page or a guided setup flow?
- How much context from the board/blocker should remain visible while the user repairs setup?
- How should missing readiness actions stay visible without overwhelming the operator?

The user selected the scannable settings-page direction over a step-by-step wizard.

## Approaches

### A. Scannable Workspace Settings Page

- Flow: blocked run links to `/w/:key/settings#supabase`; Supabase section shows readiness summary, visible missing actions, connected-state facts, and inline connect/token/branch controls.
- Pros: best match for the user's requested direction; reuses `AppSettingsPage` structure and existing Supabase/settings primitives; all missing actions remain visible; shareable workspace URL.
- Cons: needs careful hierarchy so the page does not become a wall of controls.
- Existing-fit: high. Reuses `Topbar`, workspace route shell, settings section nav, `StatusChip`, `SupabaseSettingsSection`, `SupabaseSetupCard`, `SecretMaintenanceRow`, and `BranchLifecycleStepper`.
- Mobile: nav stacks above content; actions wrap; all critical actions remain visible.

### B. Split Readiness And Action Detail

- Flow: left panel lists readiness checks; selecting a check updates the right action/detail panel.
- Pros: keeps the current blocker visible while the operator works one action at a time; good for deeper troubleshooting.
- Cons: introduces a split-view settings behavior not used elsewhere; weaker mobile fit; hides secondary controls behind selection.
- Existing-fit: medium. Reuses status rows and form primitives but needs a new detail-panel pattern.
- Mobile: split view collapses to stacked panels and loses some value.

### C. Board Blocker Plus Workspace Settings Deep Link

- Flow: board/item shows a compact Supabase blocker panel with all missing actions and a primary link to workspace settings; actual setup happens on `/w/:key/settings`.
- Pros: preserves item context and makes blocked-run origin obvious; useful as a companion to any settings approach.
- Cons: cannot satisfy setup alone; risks duplicating too much settings logic if expanded.
- Existing-fit: high for blocker display via `Board`, `BoardItemModal`, `AttentionDot`, and existing blocked-run patterns.
- Mobile: compact blocker works, but the full repair still belongs on settings.

### D. Accordion Checklist Inside Workspace Settings

- Flow: Supabase section is a checklist of collapsible setup tasks: token, project, branch, retry.
- Pros: keeps all actions visible while hiding dense guidance until needed; useful if manual setup copy is long.
- Cons: can obscure the concept requirement that all missing actions are surfaced at once; adds accordion behavior not currently central to settings.
- Existing-fit: medium. Reuses settings cards and status chips, but likely needs a new accordion/checklist component.
- Mobile: good; one task per vertical block.

## Trade-off Matrix

| Approach | Speed | Clarity | Complexity | Mobile fit | Existing fit | Risk |
|---|---:|---:|---:|---:|---:|---|
| A. Scannable Workspace Settings Page | 5 | 4 | 2 | 4 | 5 | 2 |
| B. Split Readiness And Action Detail | 3 | 4 | 4 | 2 | 3 | 3 |
| C. Board Blocker Plus Deep Link | 4 | 3 | 2 | 4 | 5 | 3 |
| D. Accordion Checklist | 4 | 3 | 3 | 5 | 3 | 3 |

## Recommendation

Use Approach A as the primary workspace settings direction, with a compact piece of Approach C for the blocked-run origin state. The repair surface should be `/w/:key/settings#supabase`, where the operator sees a readiness summary, all missing actions, and inline setup controls. The board/item blocker should stay small and send the user to the correct workspace settings instead of duplicating setup.

## Selected Direction

Approach A is selected: a scannable workspace settings page at `/w/:key/settings#supabase`, plus a compact board/item blocker that deep-links to that page. Required paste/input fields are visible on the Supabase settings page rather than hidden behind a separate wizard step: Supabase project ref, Supabase Management API token, and persistent test branch create/attach choice.

## Shape Brief

- Primary job: make Supabase readiness fixable for the exact workspace whose DB-relevant run is blocked.
- User context: the operator may arrive from CLI setup, a blocked board item, or direct workspace settings navigation.
- Information shape: readiness checklist plus setup actions; connected-state project/branch facts; retry affordance after readiness passes.
- Interaction container: dedicated workspace settings page under `/w/:key/settings`, with a Supabase section and section navigation.
- Existing components to preserve: `Topbar`, workspace route shell, `StatusChip`, `SupabaseSettingsSection`, `SupabaseSetupCard`, `SecretMaintenanceRow`, `BranchLifecycleStepper`, `DestroyConfirmDialog`, amber warning panels.
- New component candidates: `SupabaseReadinessSummary`, `SupabaseBlockedRunPanel`, possibly `WorkspaceSettingsPage`.
- Design constraints: dark operator-console density, square bordered panels, no marketing layout, no generic current-workspace guessing.
- Anti-goals: no wizard as the primary setup container; no app-global `/settings` fallback for workspace Supabase setup; no client-supplied workspace/path authority.

## Conversation Notes

- Questions asked: should Supabase workspace settings feel like one scannable settings page or a step-by-step guided setup flow?
- User answers: "A" - scannable settings page.
- Assumptions: approach exploration can still compare nearby variants, but the recommended direction should preserve a scannable workspace settings page.

## Open Decisions For User

- Decide whether long manual Supabase guidance should be always visible, collapsible, or linked from the readiness summary.
