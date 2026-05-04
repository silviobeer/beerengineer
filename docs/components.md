# Shared Component Registry

This registry is a planning aid for UI implementation waves. Code remains the source of truth.

## Existing Reuse Candidates

### Root-level primitives (`apps/ui/components/`)

- `Topbar` — `@/components/Topbar`; app brand/header used by setup and settings shells.
- `WorkspaceSwitcher` — `@/components/WorkspaceSwitcher`; workspace selection; not used during first-run setup (no workspace yet).
- `StatusChip` — `@/components/StatusChip`; compact pill for done/blocked/checking/skipped/recommended/configured/disabled states; driven by `deriveStatusLabel` in `lib/statusLabel.ts`; used by setup gate, settings recheck, and secret rows.
- `MiniStepper` — `@/components/MiniStepper`; horizontal token row for in-progress sub-stage highlighting; supports pluggable `stages`/`labels`; used on board cards (implementation + frontend columns); too compact for a branch-lifecycle stepper.
- `FailureIndicator` — `@/components/FailureIndicator`; 8px red dot with glow; run-failed marker.
- `AttentionDot` — `@/components/AttentionDot`; 8px amber dot with glow; open-prompt / review-gate / blocked-run marker on board cards.
- `BoardItemModal` — `@/components/BoardItemModal`; existing overlay pattern; reference for restrained modals, not a PROJ-4 primary container.
- `Board`, `Column`, `KanbanColumn`, `BoardCard`, `ItemCard` — dense board primitives; settings and status surfaces should preserve the same operator-console density (`border-zinc-800 bg-zinc-900/60` card language).
- `LogLine`, `LogRail`, `ChatPanel`, `ItemMessages`, `ItemChat` — log/chat surfaces; mono-label and dense-state references; not PROJ-4 building blocks.
- `ItemDetailView`, `ItemDetailHeader`, `ItemDetailToolbar` — item detail sub-components in `components/itemDetail/`; `ItemDetailHeader` uses `statusChipText` (not `StatusChip`) for a rounded-full pill; reference for phase+stage display.
- `WaveRow` — `@/components/WaveRow` (`apps/ui/components/WaveRow.tsx`); per-wave status row composing `StatusChip` (DB / non-DB) + `BranchLifecycleStepper` for DB-relevant waves; consumes a `WaveRowDbRelevance` (`explicit` | `override` | `detector`) plus optional lifecycle steps and Supabase branch metadata.

### Status / label library (`apps/ui/lib/`)

- `lib/statusLabel.ts` — `deriveStatusLabel(phaseStatus, currentStage)` maps engine states → human labels; feeds `StatusChip`; PROJ-4 status pills must go through this function.
- `lib/statusChip.ts` — `statusChipText(phaseStatus, currentStage)` produces composite "Phase · Stage" strings for item detail headers.
- `lib/setup/types.ts` — `statusLabel()` maps setup statuses (ok/missing/checking/…) → chip display tokens; `WizardStepState`, `SetupLevel`, `SecretMetadata` types all reusable.
- `lib/types.ts` — `IMPLEMENTATION_STAGES`, `DESIGN_PREP_STAGES`, `mapEngineStageToImplementationSegment()`, `BoardCardDTO`, `ConversationEntry`.

### Setup wizard (`apps/ui/components/setup/`)

- `SetupWizardShell` — full-page first-run container; composes Topbar + stepper + gate + support zone.
- `SetupProgressStepper` — 5-gate horizontal stepper with `done/blocked/checking/locked/finished` step states; driven by `deriveCurrentStep(report)`; the closest existing stepper to a branch-lifecycle stepper but step count and labels are hardcoded for app setup gates.
- `SetupGateBox` — current-step decision box; re-check / initialize / skip / next controls with abort-safe fetch; references `VerificationGateControls`.
- `SetupSupportZone` — installation remedies and optional-service config below the gate; composes `InstallationOptionCard` + `SonarSetupCard`.
- `VerificationGateControls` — action button strip (Re-check / Initialize / Skip / Next) with busy/blocked guard.
- `InstallationOptionCard` — bordered card showing a failing check with hint, URL, `CommandCopyBlock`, and `AgentPromptBlock`.
- `CommandCopyBlock` — copyable monospace command with clipboard feedback; `label` prop optional.
- `AgentPromptBlock` — copyable plain-text agent prompt; UI never executes.
- `SonarSetupCard` — bordered card combining org-text input + SONAR_TOKEN password input with separate save actions; pattern for a "service credential" setup card.

### Settings page (`apps/ui/components/settings/`)

- `AppSettingsPage` — page shell with two-column layout (220px sticky nav + content); section anchors for Setup status / App config / Secrets / Sonar / Optional services.
- `SetupStatusSection` — per-group recheck list; uses `StatusChip`; abort-safe per-group or global recheck with inline error display; `aria-live` region.
- `AppConfigSection` — 2-column grid of label+input fields with inline rejected-field amber error spans; `PartialSaveSummary` at top; amber CTA button.
- `SecretMaintenanceRow` — bordered article with redacted secret metadata, password input, and Replace/Test/Disable/Reactivate/Delete actions; two-click confirm on delete; `StatusChip` for current state. **Primary secret-entry primitive for PROJ-4.**
- `PartialSaveSummary` — `<output>` element showing mixed save results (saved count or rejected field list with amber warning).

### Capability palette (PROJ-3, engine-side only)

PROJ-3 capability work (Sonar, CodeRabbit, GitHub capability CLI) is entirely engine/CLI-side. No new UI components were added. The existing `StatusChip` + `SetupStatusSection` cover all capability display the UI currently shows. The status color vocabulary is:
- **done / configured** → `border-zinc-700 bg-zinc-800/60 text-zinc-200` (neutral chip)
- **blocked / missing** → amber text `text-amber-300` inline error (not a chip variant)
- **checking** → same chip with "Checking" label; button `disabled:opacity-45`
- **emerald** `text-emerald-300` → success inline `<output>` (not a chip); used in `SonarSetupCard` and `PartialSaveSummary`.

---

## New Component Candidates From PROJ-2

- `SetupWizardShell` — **built**; see above.
- `SetupProgressStepper` — **built**; see above.
- `SetupGateBox` — **built**; see above.
- `SetupSupportZone` — **built**; see above.
- `InstallationOptionCard` — **built**; see above.
- `CommandCopyBlock` — **built**; see above.
- `AgentPromptBlock` — **built**; see above.
- `VerificationGateControls` — **built**; see above.
- `AppSettingsPage` — **built**; see above.
- `SecretMaintenanceRow` — **built**; see above.
- `PartialSaveSummary` — **built**; see above.

---

## New Component Candidates From PROJ-4

- `BranchLifecycleStepper` — PRD-5 + PRD-9; horizontal step indicator for branch states (creating → ready → in-use → retained → destroying); `MiniStepper` and `SetupProgressStepper` are both wrong shapes — no existing stepper maps cleanly.
- `RetainedBranchBanner` — PRD-3 + PRD-9; persistent top-of-section warning that a branch is retained past its run; amber border language matches `PartialSaveSummary`; no existing banner primitive.
- `PlanLimitBanner` — PRD-3 + PRD-9; quota / plan ceiling warning; same amber-border pattern as `RetainedBranchBanner` but distinct copy and action link.
- `DestroyConfirmDialog` — PRD-3 + PRD-8 + PRD-9; modal with typed branch-name input gate before destructive action; `BoardItemModal` is the closest overlay reference but is not a confirm dialog.
- `CleanupPolicySelector` — PRD-3; select + conditional TTL number field for branch retention policy; extends the `AppConfigSection` label+input language.
- `SupabaseSettingsSection` — PRD-3 + PRD-8; settings-page section for Supabase project status, cleanup policy, protection switch, token rotation, and persistent-branch recreate; composes `CleanupPolicySelector`, `PlanLimitBanner`, `RetainedBranchBanner`, and `DestroyConfirmDialog`.
- `SupabaseSetupCard` — PRD-2; setup support card for validating/connecting, rotating, or disconnecting Supabase Management API credentials; follows the credential-entry pattern from `SonarSetupCard` but targets branch-database setup.
- `MergeGatePanel` — PRD-7 + PRD-9; compact merge-readiness gate list for final validation, protection switch, destructive confirmation, and production migration; uses `StatusChip` rather than inventing a new gate badge.
- `RunOverviewBanners` — PRD-9; board/run-level wrapper that renders retained-branch and plan-limit warnings above the board when workspace cost risk is present.
- `PersistentTestBranchPicker` — PRD-2; picker to designate an existing Supabase branch as the persistent test branch during setup; fits inside `SetupSupportZone`/`SetupGateBox` flow.
- `AdoptExistingProjectPanel` — PRD-2; confirmation panel shown when a Supabase project already exists; bordered article pattern like `InstallationOptionCard` but with adopt/cancel actions.
- `PlanQuotaReadinessPanel` — PRD-2; wizard step showing plan tier, branch quota, and readiness verdict before enabling the feature; no existing analog.
