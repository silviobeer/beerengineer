# PROJ-5 UI Implementation Handoff - setup-git-readiness

## Project Mode

brownfield

## Source References

- Concept: `specs/PROJ-5-setup-git-readiness/1_brainstorm/PROJ-5-concept.md`
- Visual Companion decision: `specs/PROJ-5-setup-git-readiness/2_visual-companion/layout-decision.md`
- Mockups:
  - `specs/PROJ-5-setup-git-readiness/5_mockups/sitemap.html`
  - `specs/PROJ-5-setup-git-readiness/5_mockups/git-readiness-setup.html`
  - `specs/PROJ-5-setup-git-readiness/5_mockups/workflow-start-inline-repair.html`
- Design language: `apps/ui/docs/design-language.md`

## Selected UI Direction

Extend the existing setup wizard and item/workflow-start surfaces. The setup
Git step becomes an actionable gate that explains local Git checkpoints, shows
identity source, and repairs missing identity. Workflow-start repair appears
inline with the blocked start action and preserves the user's original intent.

## Reuse

- `apps/ui/components/Topbar.tsx` - existing page shell header.
- `apps/ui/components/setup/SetupWizardShell.tsx` - setup page container.
- `apps/ui/components/setup/SetupProgressStepper.tsx` - setup progress model.
- `apps/ui/components/setup/SetupGateBox.tsx` - required/recommended gate
  container.
- `apps/ui/components/setup/VerificationGateControls.tsx` - recheck/next
  button pattern.
- `apps/ui/components/StatusChip.tsx` - readiness labels.
- `apps/ui/components/BoardItemModal.tsx` - item-detail context for inline
  workflow-start repair.

## New Component Candidates

- `GitIdentityPanel` - displays global/workspace/app-level identity source,
  readiness, and available repair actions. No existing setup component covers
  Git identity source resolution.
- `GitIdentityForm` - shared form for display name, email, and local-only
  placeholder warning.
- `WorkflowGitRepairPanel` - inline blocked-start repair panel that preserves
  original run intent and exposes apply/recheck/continue actions.

## Design Tokens And Styling

- Use the existing dark petrol setup surface: `bg-zinc-950`, `bg-zinc-900`,
  `border-zinc-800`, cream text, and gold for user-needed actions.
- Use `StatusChip` style for ok/missing/blocked/readiness states.
- Avoid new palettes, soft rounded cards, shadows, or marketing-style
  explanatory sections.
- Existing app design takes precedence over exact HTML mockup CSS: yes.

## Interaction Contract

- Setup Git step shows global readiness when no workspace is selected and
  workspace readiness when a registered workspace is selected.
- Missing Git renders a not-configured stub with install guidance and recheck
  controls; the identity form is hidden until Git is available.
- App-level identity can be saved from setup and reused by workspace repair.
- Workspace repair writes repo-local identity only after user confirmation.
- After repair, readiness is rechecked from a fresh engine response, including
  partial failure states.
- Workflow-start block appears before any execution side effect and keeps the
  original item/start context visible.
- Successful inline repair returns to the original start action.
- Mobile behavior: panels stack vertically; controls wrap; text must remain
  readable at 375px.

## Implementation Tolerance

- Mockups are structural, not pixel-perfect.
- Existing React components and design tokens take precedence over mockup CSS.
- Preserve the selected layout direction and interaction contract unless the
  user approves a change.
- It is acceptable to implement the workflow-start repair as an existing modal
  if it remains contextual and preserves the original start action.

## Demo-Only In Mockup

- The example identity values are placeholders.
- The timeline in the workflow-start mockup explains intent preservation; it is
  not required as a visible production component.
- The tabbed state switcher in `git-readiness-setup.html` is only for review of
  states; production can render states conditionally.

## Open UI Risks

- The final workflow-start container depends on the existing item start
  implementation and may be a modal, panel, or in-place blocker as long as the
  intent-preservation contract holds.
- Copy must stay beginner-safe without implying GitHub publishing is part of
  this scope.
- Email/local-only warnings need to be concise enough for the setup gate.

