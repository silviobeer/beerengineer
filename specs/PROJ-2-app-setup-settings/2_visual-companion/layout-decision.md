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

### C. Single-Task Wizard

- Flow: Full-page wizard with one nearly full-screen task. It still shows a compact 5-step indicator, but the current action dominates the page.
- Pros: Most wizard-like and least distracting; ideal for first-time users who should do exactly one thing.
- Cons: Can feel slow or oversized for form-heavy steps like app config and secrets.
- Existing-fit: Biggest departure from current board UI, but that is acceptable for first-run setup.
- Mobile: Strong, because one task at a time maps cleanly to narrow screens.

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
| C. Single-Task Wizard | 5 | 4 | 5 | 2 | 5 | 3 | 3 |
| D. Runbook Wizard | 4 | 4 | 4 | 3 | 4 | 4 | 3 |

## Recommendation

Use **A. Centered Wizard** as the primary `/setup` shape, with **D. Runbook Wizard** blocks inside dependency and auth steps.

This responds directly to the desired mental model: the user should immediately see "Step 2 of 5" and understand there are three steps left. A centered full-page wizard also cleanly moves away from the board layout, which is good here because first-run setup is not workspace work. It should feel like an install/setup flow, not another board surface.

For later Eigenschaften, reuse the same ordered sections and status model, but allow direct section selection once setup is complete. The first-run wizard can be strict; maintenance mode can be more navigable.

## Shape Brief

- Primary job: guide a new local user through app-level setup one step at a time, with visible progress and hard gates for required checks.
- User context: no workspace or incomplete setup; likely switching between UI and terminal.
- Information shape: five ordered steps, current step number, remaining step count, required/optional status, command remedies, verification state, app-config fields, secret metadata.
- Interaction container: dedicated `/setup` full-page wizard, not the board layout.
- Existing components to preserve: beerengineer_ brand/topbar, status/check language, API proxy boundary, sharp operator-console styling, concise command remedies.
- New component candidates: wizard shell, horizontal/stacked progress stepper, locked future step token, step content panel, runbook command block, verification gate, partial-save summary, secret maintenance row.
- Design constraints: low-fidelity here; final UI should stay operational and direct, not marketing onboarding.
- Anti-goals: board-like dashboard as primary setup, automatic external tool installation, workspace/project setup in v1, SonarCloud project creation, live engine-port migration.

## Conversation Notes

- Questions asked:
  - For first-run setup, should users be forced through a linear wizard or jump freely between setup sections?
- User answers:
  - Chose "C. Hybrid: guided recommended path, but sections are still jumpable."
  - After seeing the first exploration, requested approaches that become a clearer, tightly guided step-by-step process.
  - After seeing the second exploration, clarified that all variants were still not wizard-like enough. The desired shape should show "I am now in step 2 and have 3 steps ahead"; it may move away from the board layout.
- Assumptions:
  - The concept from `1_brainstorm/PROJ-2-concept.md` is accepted.
  - `/setup` should optimize first-time clarity more than existing board continuity.
  - Required setup steps should be gated; optional areas can be shown but should not block completion.
  - Existing app shell patterns are constraints for tone and API behavior, not for the setup page layout.
  - Eigenschaften can be less restrictive than first-run setup, but should share the same ordered sections and status language.

## Open Decisions For User

- Choose the preferred wizard shell:
  - A. Centered Wizard
  - B. Rail Wizard
  - C. Single-Task Wizard
  - D. Runbook Wizard
  - Recommended combination: A with D-style command/verification blocks for technical steps.
- Decide whether the first-run setup should have exactly five steps or whether the step count should adapt when optional services are skipped.
- Decide whether future locked steps should be visible as names or only as generic remaining-step markers.
- Decide whether Eigenschaften should reuse the same wizard shell in maintenance mode or switch to a denser section editor after setup is complete.

