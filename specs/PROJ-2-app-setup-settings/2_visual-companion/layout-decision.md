# PROJ-2 Visual Companion — app-setup-settings

## Existing UI Patterns

- Active UI lives in `apps/ui/components/*` and `apps/ui/app/w/**`.
- Current product shell has a sticky `Topbar`, `WorkspaceSwitcher`, a workspace-scoped board route at `/w/[key]`, and no shipped setup/settings route yet.
- The main shipped interaction container is `BoardItemModal`, opened from `Board.tsx` local state. The UI deliberately uses a modal for item detail rather than a route.
- Board content is dense, operational, and scan-oriented: columns, cards, status chips, stepper, logs, and chat panels.
- Writes go through `apps/ui/app/api/**` route handlers so the browser never receives the engine CSRF token.
- Visual language is a dark operator console with sharp borders, low radius, mono labels, and restrained accent use.
- Existing docs already name `/setup` and app-level settings as intended surfaces, but active code does not yet implement them.

## Project Mode

- Mode: hybrid
- Evidence: The UI has a real shell, design language, active component tree, modal pattern, SSE architecture, and proxy pattern. However, first-run setup can deliberately move away from the board layout because no existing setup route or settings surface constrains it.
- Design/component gaps: no existing setup wizard, no full-page first-run flow, no guided runbook/checklist primitive, no form-heavy app-config surface, and no mobile setup pattern.

## Layout Decision To Make

- What kind of dedicated wizard should `/setup` use?
- How should the wizard show "I am on step 2 and there are 3 steps left"?
- Should dependency/auth steps use a special command/verification panel inside the wizard?
- How much, if any, of the existing workspace shell should remain visible during first-run setup?

## Approaches

### A. Centered Wizard

- Flow: Dedicated `/setup` page with a centered content area, horizontal 5-step progress, "Step 2 of 5" heading, locked future steps, and one main step panel.
- Pros: Strong wizard identity, clear progress, good balance of context and focus, visibly separate from the board.
- Cons: Horizontal stepper can get tight on small screens; complex steps may need careful layout inside the panel.
- Existing-fit: Keeps beerengineer_ topbar/branding and status language, but intentionally leaves the board layout behind.
- Mobile: Stepper stacks into one column; content becomes single-column.

### B. Rail Wizard

- Flow: Dedicated wizard with a left progress rail and right step content. The rail shows done/current/locked states, while the content focuses on the active step.
- Pros: Very clear "where am I" model; good for users who want to see previous and upcoming steps at all times.
- Cons: More structural UI than A; left rail consumes space and needs a mobile stacking rule.
- Existing-fit: Similar to operational navigation but not tied to workspace board.
- Mobile: Rail stacks above content.

### C. Gate Box Wizard

- Flow: Dedicated wizard where the current step has one central gate box. The box states the blocker, for example "Git is not installed", and owns the navigation buttons: `Skip` only if the check is optional, and `Next` only when the required gate passes. Installation options, command snippets, links, and local-agent prompts live underneath the gate box, outside the main decision area.
- Pros: Feels more like a true wizard than a content page; the user can immediately see whether the current step is blocked, skippable, or ready to continue. Separating the gate from installation help keeps the action model simple.
- Cons: Requires disciplined content hierarchy. If every step adds too much supporting material below the box, the page can still become long.
- Existing-fit: Still departs from the board layout, but keeps the operator-console status language and button states.
- Mobile: Strong, because the central gate box remains first and support material stacks below it.

### D. Runbook Wizard

- Flow: A normal wizard shell, but each technical step is structured as instruction, command, verification, and continue gate.
- Pros: Best for dependency/auth steps; very concrete for users switching between UI and terminal.
- Cons: Too verbose as the whole wizard style; works better as a step content pattern inside A or B.
- Existing-fit: Matches existing `doctor` remedy command model and operator-console tone.
- Mobile: Good as a stacked checklist; command wrapping needs care.

## Trade-off Matrix

| Approach | Wizard feel | Progress clarity | Focus | Handles complex forms | Mobile fit | Existing fit | Risk |
|---|---:|---:|---:|---:|---:|---:|---:|
| A. Centered Wizard | 5 | 5 | 4 | 4 | 4 | 4 | 2 |
| B. Rail Wizard | 5 | 5 | 4 | 4 | 3 | 4 | 2 |
| C. Gate Box Wizard | 5 | 5 | 5 | 3 | 5 | 4 | 2 |
| D. Runbook Wizard | 4 | 4 | 4 | 3 | 4 | 4 | 3 |

## Recommendation

Use **C. Gate Box Wizard** as the selected `/setup` shape.

This responds directly to the desired mental model: the user should immediately see "Step 2 of 5" and understand there are three steps left, but the current step should not feel like a general information page. The central box is the wizard decision point: it says what is wrong, whether the step can be skipped, and whether `Next` is available. For a required dependency such as Git, `Skip` is disabled and `Next` is disabled until verification passes. Installation options sit below the box as supporting material, not inside the core gate.

For later Eigenschaften, reuse the same ordered sections and status model, but allow direct section selection once setup is complete. The first-run wizard can be strict; maintenance mode can be more navigable.

## Selected Direction

- Selected: **C. Gate Box Wizard**.
- Refinement: make the wizard feel more like a true stepper flow. Each active step has one central gate box with the current blocker, `Skip`, `Re-check`, and `Next`.
- Refinement: keep installation options, docs/source links, command snippets, and optional local-agent prompts underneath the gate box, outside the central decision area.
- Refinement: `Skip` is shown only as an action affordance where it helps the mental model, but it is disabled for required checks such as Git. `Next` is disabled until the required gate passes.
- Refinement: every step needs an explicit gate indicator. The user must immediately know whether the current step is done and they can continue, or whether it is blocked and why.
- Setup may intentionally move away from the existing board layout. Existing UI patterns still matter for tone, status language, and API safety, but not for the primary first-run container.
- Step count should remain visible at all times, e.g. "Step 2 of 5" plus visible remaining locked steps.

## Shape Brief

- Primary job: guide a new local user through app-level setup one step at a time, with visible progress and hard gates for required checks.
- User context: no workspace or incomplete setup; likely switching between UI and terminal.
- Information shape: five ordered steps, current step number, remaining step count, explicit step state, required/optional status, command remedies, verification state, app-config fields, secret metadata.
- Interaction container: dedicated `/setup` full-page gate-box wizard, not the board layout.
- Existing components to preserve: beerengineer_ brand/topbar, status/check language, API proxy boundary, sharp operator-console styling, concise command remedies.
- New component candidates: wizard shell, horizontal/stacked progress stepper, locked/focused/done step token, central gate box, disabled/enabled skip and next states, support-material zone, installation option cards, command block, agent-prompt block, verification gate, continue-unlocked state, partial-save summary, secret maintenance row.
- Design constraints: low-fidelity here; final UI should stay operational and direct, not marketing onboarding.
- Anti-goals: board-like dashboard as primary setup, automatic external tool installation, workspace/project setup in v1, SonarCloud project creation, live engine-port migration.

## Conversation Notes

- Questions asked:
  - For first-run setup, should users be forced through a linear wizard or jump freely between setup sections?
- User answers:
  - Chose "C. Hybrid: guided recommended path, but sections are still jumpable."
  - After seeing the first exploration, requested approaches that become a clearer, tightly guided step-by-step process.
  - After seeing the second exploration, clarified that all variants were still not wizard-like enough. The desired shape should show "I am now in step 2 and have 3 steps ahead"; it may move away from the board layout.
  - Selected C, with more explanatory text, download/source guidance, and a prompt for the local agent.
  - Requested clearer indicators for whether the current step is completed and the user can continue, or not completed and blocked.
  - Clarified that the wizard form itself still was not right: the active step should show a central box such as "Git is not installed", with `Skip` disabled when not allowed and `Next` disabled while blocked; installation options should appear below, outside the central box.
- Assumptions:
  - The concept from `1_brainstorm/PROJ-2-concept.md` is accepted.
  - `/setup` should optimize first-time clarity more than existing board continuity.
  - Required setup steps should be gated; optional areas can be shown but should not block completion.
  - Existing app shell patterns are constraints for tone and API behavior, not for the setup page layout.
  - Eigenschaften can be less restrictive than first-run setup, but should share the same ordered sections and status language.

## Open Decisions For User

- Decide whether the first-run setup should have exactly five steps or whether the step count should adapt when optional services are skipped.
- Decide whether future locked steps should be visible as names or only as generic remaining-step markers.
- Decide whether Eigenschaften should reuse the same wizard shell in maintenance mode or switch to a denser section editor after setup is complete.
- Decide whether required steps should still show a disabled `Skip` button for consistency, or hide `Skip` entirely when skipping is impossible.
