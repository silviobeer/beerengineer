# PROJ-6 UI Implementation Handoff - Supabase Readiness Gate

## Project Mode

brownfield

## Source References

- Concept: `specs/PROJ-6-supabase-readiness-gate/1_brainstorm/PROJ-6-concept.md`
- Visual Companion decision: `specs/PROJ-6-supabase-readiness-gate/2_visual-companion/layout-decision.md`
- Mockups:
  - `specs/PROJ-6-supabase-readiness-gate/5_mockups/sitemap.html`
  - `specs/PROJ-6-supabase-readiness-gate/5_mockups/workspace-supabase-settings.html`
  - `specs/PROJ-6-supabase-readiness-gate/5_mockups/board-blocked-run.html`
- Design language: existing app tokens in `apps/ui/app/globals.css`; no new PROJ-6 design language file.

## Selected UI Direction

Use a scannable workspace settings page at `/w/:key/settings#supabase`, with visible Supabase setup inputs directly on the page. A compact board/item blocked-run panel preserves run context and deep-links to the workspace settings page; it does not duplicate the setup form.

## Reuse

- `apps/ui/components/Topbar.tsx` - workspace shell header.
- `apps/ui/app/w/[key]/layout.tsx` - workspace route provider/SSE shell pattern.
- `apps/ui/components/settings/AppSettingsPage.tsx` - two-column settings layout reference.
- `apps/ui/components/StatusChip.tsx` - readiness and branch status chips.
- `apps/ui/components/settings/SupabaseSettingsSection.tsx` - connected Supabase settings facts and controls.
- `apps/ui/components/setup/SupabaseSetupCard.tsx` - project-ref/token connection pattern.
- `apps/ui/components/settings/SecretMaintenanceRow.tsx` - token entry/rotation behavior reference.
- `apps/ui/components/lifecycle/BranchLifecycleStepper.tsx` - persistent branch health and lifecycle display.
- `apps/ui/components/dialogs/DestroyConfirmDialog.tsx` - destructive branch recreate confirmation, if needed.
- `apps/ui/components/Board.tsx`, `ItemCard`, `BoardItemModal` patterns - compact blocked-run entry point.

## New Component Candidates

- `WorkspaceSettingsPage` - workspace-scoped sibling to `/w/:key`, using the settings section-nav pattern but resolving workspace by key.
- `SupabaseReadinessSummary` - top-of-section summary for ready/blocked state, missing action list, and retry affordance.
- `SupabaseBlockedRunPanel` - compact board/item blocker that lists missing actions and links to `/w/:key/settings#supabase`.

## Design Tokens And Styling

- Use: `bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`, `text-zinc-100`, `text-zinc-400`, amber warning utilities, emerald/petrol success utilities, `font-display` for headings, `font-mono` for workspace keys/project refs.
- Use square bordered panels consistent with board and settings surfaces.
- Avoid: card-within-card decoration, marketing copy/layout, rounded hero styling, app-global current-workspace guessing.
- Existing app design takes precedence over exact HTML mockup CSS: yes.

## Interaction Contract

- Workspace settings route:
  - `/w/:key/settings#supabase` must resolve workspace explicitly from `key`.
  - Supabase setup inputs are visible on the scannable page: project ref, Management API token, persistent branch create/attach choice.
  - Not-configured state shows a stub plus setup inputs; connected-only controls are hidden until the capability is present.
  - Recheck readiness uses engine readiness state and displays blocked/ready/loading/error states.
  - Retry run is disabled until readiness is ready, then re-enters the same blocked run.
- Board blocked-run panel:
  - Shows all relevant missing actions in a compact panel.
  - Primary action links to `/w/:key/settings#supabase`.
  - Does not include token/project paste fields.
- Required states:
  - Normal blocked
  - Empty/not configured
  - Loading/rechecking
  - Error/provider/auth failure
  - Success/ready to retry
- Responsive/mobile behavior:
  - Workspace settings nav stacks above content.
  - Inputs remain visible without horizontal scroll at 375px.
  - Board blocker remains compact; repair happens on settings page.

## Implementation Tolerance

- Mockups are structural, not pixel-perfect.
- Existing React components and design tokens take precedence over mockup CSS.
- Preserve the selected layout direction and interaction contract unless the user approves a change.
- Manual Supabase guidance may be collapsible or linked if the main paste inputs remain visible.

## Demo-Only In Mockup

- Example project ref `abcdefghijklmnopqrst`.
- Example workspace `alpha`.
- Simplified board columns and cards.
- The success-state jump button in the HTML mockup.
- Placeholder external Supabase guidance copy.

## Open UI Risks

- Long manual setup guidance could crowd the settings page; final UI should keep paste fields visible while allowing detailed guidance to collapse or link out.
- `SupabaseSettingsSection` currently lives in app settings and may need extraction into workspace-scoped pieces.
- Board blocked-run copy must stay concise so it does not become a second setup surface.
- Retry affordance must be clearly tied to the same blocked run, not a new run.

