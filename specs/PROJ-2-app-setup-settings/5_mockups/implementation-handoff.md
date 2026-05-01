# PROJ-2 UI Implementation Handoff — app-setup-settings

## Project Mode

hybrid

## Source References

- Concept: `specs/PROJ-2-app-setup-settings/1_brainstorm/PROJ-2-concept.md`
- Visual Companion decision: `specs/PROJ-2-app-setup-settings/2_visual-companion/layout-decision.md`
- Mockups:
  - `specs/PROJ-2-app-setup-settings/5_mockups/sitemap.html`
  - `specs/PROJ-2-app-setup-settings/5_mockups/PROJ-2-setup-wizard.html`
  - `specs/PROJ-2-app-setup-settings/5_mockups/PROJ-2-settings-maintenance.html`
- Design language: existing app docs and tokens:
  - `apps/ui/docs/design-language.md`
  - `apps/ui/app/globals.css`

## Selected UI Direction

Use a dedicated `/setup` full-page **Single-Task Wizard**. The setup page may move away from the board layout. The user must always see the current step number, total steps, future locked steps, and a strong gate indicator that says whether the current step is blocked, checking, done, or ready to continue. Dependency/auth steps include explanation, official download/docs source, command, optional local-agent prompt, and verification gate.

The later Eigenschaften page reuses the same ordered setup sections and status language, but works in maintenance mode with direct section navigation and partial-save feedback.

## Reuse

- `apps/ui/components/Topbar.tsx` — reuse brand/topbar language where suitable; `/setup` may use a simplified no-workspace topbar.
- `apps/ui/components/StatusChip.tsx` — reuse compact status-chip visual language for step/gate states.
- `apps/ui/components/MiniStepper.tsx` — reuse or adapt the mono step-token language, but the setup wizard likely needs a new larger wizard stepper.
- `apps/ui/components/FailureIndicator.tsx` — reuse failure-dot language for blocked checks.
- `apps/ui/lib/engine/proxy.ts` and `apps/ui/app/api/**` route pattern — all setup/settings mutations must proxy through Next.js route handlers.

## New Component Candidates

- `SetupWizardShell` — dedicated full-page setup container with no board columns.
- `SetupProgressStepper` — large five-step progress indicator with done/current/locked labels.
- `SetupGateBanner` — explicit current-step state: blocked, checking, complete, continue unlocked.
- `SetupInstructionPanel` — rich single-task content with explanation, command, docs/download link, agent prompt, and verification.
- `CommandCopyBlock` — copyable shell command with status feedback.
- `AgentPromptBlock` — copyable prompt for local agents; no execution by UI.
- `SecretMaintenanceRow` — redacted secret metadata with replace/test/disable/delete actions.
- `PartialSaveSummary` — shows which fields saved and which were rejected.

## Design Tokens And Styling

- Use:
  - Petrol/warm dark scale from `globals.css` zinc overrides.
  - Gold (`amber-400` / `--color-gold`) for primary attention and current action.
  - Petrol/emerald tokens for success/ready states.
  - Existing mono label style for commands, step numbers, and state labels.
  - Sharp corners and 1px borders.
- Avoid:
  - Board-column layout for `/setup`.
  - Marketing onboarding visuals.
  - Rounded card-heavy composition.
  - Loud nested card stacks where every section has equal visual weight.
  - Decorative status panels when a quiet divider or compact chip is enough.
  - Showing secret values after they are stored.
- Existing app design takes precedence over exact HTML mockup CSS: yes.
- Visual reduction rule: keep the setup wizard closer to the existing board/modal language than to a dashboard. Prefer one main container, subtle dividers, compact mono labels, and a single strong gate indicator over many bordered panels.

## Interaction Contract

- `/setup`:
  - Shows current step as `Step N of 5`.
  - Shows all five step names with state: done, current/blocked, locked, finished.
  - Current step has a gate banner.
  - Continue is disabled while the gate is blocked or checking.
  - Verification can move the gate to success and unlock Continue.
  - Technical steps include explanation, download/docs source, command, local-agent prompt, and verification.
  - Required checks block; optional checks can be skipped or deferred.
- `/settings`:
  - Uses direct section navigation after setup.
  - Valid fields can save while invalid fields remain visible and unchanged.
  - Secret rows show metadata only; replace/test/delete actions never reveal stored values.

## Required States

- Normal: current step blocked with instructions.
- Loading: verification running, continue disabled.
- Error: verification failed or partial save rejected some fields.
- Success: current step complete and continue unlocked.
- Empty: no missing required dependency or no stored secrets.

## Responsive/Mobile Behavior

- `/setup` stacks the stepper vertically on narrow screens.
- The active step remains above long instructional content.
- Commands and agent prompts must wrap without horizontal overflow.
- `/settings` side navigation stacks above section content.

## Implementation Tolerance

- Mockups are structural, not pixel-perfect.
- Existing React components and design tokens take precedence over mockup CSS.
- Preserve the selected layout direction and interaction contract unless the user approves a change.
- The exact number of setup steps may be adjusted during requirements, but the UI must keep an explicit current/total step indicator.

## Demo-Only In Mockup

- `Simulate passed check` is only a visual state toggle.
- The npm/package URLs are example copy for visual review; implementation should use canonical docs/remedy data from engine where available.
- Labels such as `[Normal State]` and `[New candidate: ...]` are mockup annotations, not production UI.

## Open UI Risks

- Whether `/setup` always has exactly five steps or adapts when optional services are skipped remains open.
- Whether locked future steps show exact names or generic remaining markers remains open.
- Maintenance mode may need a denser layout than the wizard for frequent operators.
- The UI needs backend support for app-config patching, setup initialization, secret metadata, and explicit secret tests before production behavior can match the mockups.
