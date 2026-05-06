# PROJ-5 Layout Decision: Setup Git Readiness

## Project Mode

brownfield

## Selected Direction

Extend the existing `/setup` wizard and existing workflow-start surfaces. No new
top-level setup page is introduced.

## Shape Brief

- Setup Git readiness appears inside the current setup wizard content area.
- The existing stepper remains the navigation model.
- The Git step becomes an actionable gate with identity source, app-level
  default identity, workspace repair, and recheck controls.
- Missing Git renders a not-configured stub instead of the identity form.
- Workflow-start repair appears inline with the blocked start action, preferably
  as an existing modal/dialog pattern or in-place panel near the start control.

## Existing UI Patterns

- `apps/ui/components/Topbar.tsx`
- `apps/ui/components/setup/SetupWizardShell.tsx`
- `apps/ui/components/setup/SetupProgressStepper.tsx`
- `apps/ui/components/setup/SetupGateBox.tsx`
- `apps/ui/components/setup/VerificationGateControls.tsx`
- `apps/ui/components/StatusChip.tsx`
- `apps/ui/components/BoardItemModal.tsx`

## Design/Component Gaps

- A dedicated Git readiness panel does not exist yet.
- A reusable identity form may be needed.
- Workflow-start inline repair needs a small blocked-state interaction contract.

## Notes

This layout decision records the already-approved concept direction so
UI-mockup and requirements work have a stable brownfield input. It intentionally
does not explore alternative containers.

