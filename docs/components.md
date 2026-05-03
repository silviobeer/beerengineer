# Shared Component Registry

This registry is a planning aid for UI implementation waves. Code remains the source of truth.

## Existing Reuse Candidates

- `Topbar` - `apps/ui/components/Topbar.tsx`; app brand/header language for workspace and setup surfaces.
- `WorkspaceSwitcher` - `apps/ui/components/WorkspaceSwitcher.tsx`; workspace selection pattern, not directly reused by first-run setup when no workspace exists.
- `StatusChip` - `apps/ui/components/StatusChip.tsx`; compact status vocabulary for done, blocked, checking, skipped, and related setup states.
- `MiniStepper` - `apps/ui/components/MiniStepper.tsx`; existing step-token visual language that setup can adapt into a larger progress stepper.
- `FailureIndicator` - `apps/ui/components/FailureIndicator.tsx`; blocked/failure dot and concise failure language.
- `AttentionDot` - `apps/ui/components/AttentionDot.tsx`; small attention marker for status summaries.
- `BoardItemModal` - `apps/ui/components/BoardItemModal.tsx`; existing modal pattern. PROJ-2 setup should not use this as its primary container, but the modal language is a reference for restrained overlays.
- `Board`, `Column`, `KanbanColumn`, `BoardCard`, `ItemCard` - existing dense board primitives. PROJ-2 setup deliberately avoids board layout, but settings should preserve the same operator-console density.
- `LogLine`, `LogRail`, `ChatPanel`, `ItemMessages`, `ItemChat` - existing operational text/log/chat surfaces. Useful visual references for mono labels and dense state reporting, not primary PROJ-2 building blocks.

## New Component Candidates From PROJ-2

- `SetupWizardShell` - no existing full-page first-run setup container exists.
- `SetupProgressStepper` - `MiniStepper` is too compact for five app setup gates.
- `SetupGateBox` - central current-step decision box with blocker, skip, re-check, and next controls.
- `SetupSupportZone` - separates installation/help material from the central gate decision.
- `InstallationOptionCard` - displays OS/tool-specific install remedies and commands.
- `CommandCopyBlock` - copyable command with local feedback.
- `AgentPromptBlock` - copyable local-agent prompt with no execution by UI.
- `VerificationGateControls` - re-check trigger plus blocked/checking/done feedback.
- `AppSettingsPage` - app-level maintenance surface outside workspace board routes.
- `SecretMaintenanceRow` - redacted secret metadata with replace/test/disable/reactivate/delete actions.
- `PartialSaveSummary` - mixed save result summary for valid and rejected app-config fields.
