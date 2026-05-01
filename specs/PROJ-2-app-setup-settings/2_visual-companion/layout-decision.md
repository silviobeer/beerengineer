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
- Evidence: The UI has a real shell, design language, active component tree, modal pattern, SSE architecture, and proxy pattern. Setup/settings still need new routes, navigation, form containers, and guided setup patterns.
- Design/component gaps: no existing settings page, no setup wizard, no guided runbook/checklist primitive, no form-heavy app-config surface, and no mobile setup pattern.

## Layout Decision To Make

- Which kind of **tight step-by-step process** should drive first-run setup?
- How much context should be visible while the user is blocked on the current step?
- How should later Eigenschaften reuse the same guidance without becoming a free-form dashboard?

## Approaches

### A. Strict Wizard

- Flow: User sees one active step, one current task, and one primary next action. Future steps stay locked until the current required task passes.
- Pros: Maximum clarity for first-time users, minimal cognitive load, simple blocker handling, strongest "do this now" posture.
- Cons: Slow for returning operators; hiding future steps can make optional capabilities feel less discoverable.
- Existing-fit: Reuses check rows, status language, and stepper vocabulary, but introduces a dedicated first-run container.
- Mobile: Strong fit because one task at a time stacks cleanly.

### B. Guided Checklist

- Flow: Setup is still linear, but completed/current/locked steps are visible as checklist cards. The current step expands into action details and verification.
- Pros: Clear sequence while still showing progress; users understand what is done, current, and locked. Good compromise between guidance and orientation.
- Cons: Locked future steps need careful wording so they do not feel broken.
- Existing-fit: Fits current card/status scanning patterns while adding guided progression.
- Mobile: Good; cards can stack and the active step can remain first.

### C. Coach + Detail

- Flow: A persistent coach rail pins the next required action first. Details, upcoming steps, and optional services remain visible but secondary.
- Pros: Strong "next action" focus without hiding context; can evolve naturally into Eigenschaften later.
- Cons: More complex than a pure wizard and needs a new split/rail pattern.
- Existing-fit: Similar operational density to current item modal/detail panels, but not an existing component.
- Mobile: Needs stacking rules: coach first, detail below.

### D. Setup Runbook

- Flow: Each step is an instruction/action/verification/continue gate. It reads like an operational checklist with copyable commands.
- Pros: Very concrete, terminal-friendly, strong for dependency/auth steps, easy to document.
- Cons: Verbose for simple app-config edits and can feel less like an app, more like docs with buttons.
- Existing-fit: Matches beerengineer_'s operator-console personality and remedy-command model.
- Mobile: Good for single-column instructions; long command-heavy content may need careful wrapping.

## Trade-off Matrix

| Approach | Guidance | Context | Speed | Complexity | Mobile fit | Existing fit | Risk |
|---|---:|---:|---:|---:|---:|---:|---:|
| A. Strict Wizard | 5 | 2 | 3 | 2 | 5 | 3 | 2 |
| B. Guided Checklist | 5 | 4 | 4 | 3 | 4 | 4 | 2 |
| C. Coach + Detail | 4 | 5 | 4 | 4 | 3 | 3 | 3 |
| D. Setup Runbook | 5 | 3 | 3 | 3 | 4 | 4 | 3 |

## Recommendation

Use **B. Guided Checklist** as the primary direction, with selected runbook mechanics from **D** for dependency and auth steps.

This matches the user's request for a clear, tightly guided step-by-step process while avoiding the frustration of a fully opaque wizard. The user sees the path, knows exactly which step is current, and cannot accidentally bypass required blockers. For command-heavy steps such as installing Codex or running `gh auth login`, the runbook format gives the right precision: instruction, copyable action, verification, continue gate.

Eigenschaften can reuse the same section order and status model, but it should unlock direct navigation because returning operators already know what they came to edit.

## Shape Brief

- Primary job: guide a new local user through app-level setup one step at a time, with hard gates for required checks.
- User context: no workspace or incomplete setup; likely switching between UI and terminal.
- Information shape: ordered steps, current action, command remedies, verification status, required/optional distinction, app-config fields, secret metadata.
- Interaction container: `/setup` as a guided checklist with locked future steps and an expanded current step.
- Existing components to preserve: Topbar branding, status chip/check language, API proxy boundary, sharp operator-console styling, concise command remedies.
- New component candidates: setup progress rail, locked/completed/current step cards, current-step action panel, command/remedy row, verification gate, partial-save summary, secret maintenance row.
- Design constraints: low-fidelity here; final UI should remain operational and direct, not a marketing onboarding page.
- Anti-goals: free-form dashboard as primary setup, automatic external tool installation, workspace/project setup in v1, SonarCloud project creation, live engine-port migration.

## Conversation Notes

- Questions asked:
  - For first-run setup, should users be forced through a linear wizard or jump freely between setup sections?
- User answers:
  - Chose "C. Hybrid: guided recommended path, but sections are still jumpable."
  - After seeing the first exploration, requested approaches that become a clearer, tightly guided step-by-step process.
- Assumptions:
  - The concept from `1_brainstorm/PROJ-2-concept.md` is accepted.
  - `/setup` should optimize first-time clarity more than free-form editing speed.
  - Required setup steps should be gated; optional areas can be shown but not block completion.
  - Eigenschaften can be less restrictive than first-run setup, but should share the same ordered sections and status language.

## Open Decisions For User

- Choose the preferred tight-guidance model:
  - A. Strict Wizard
  - B. Guided Checklist
  - C. Coach + Detail
  - D. Setup Runbook
  - Recommended combination: B with D-style command/verification blocks.
- Decide whether future locked steps should be visible in `/setup` or hidden until unlocked.
- Decide whether Eigenschaften should use the same guided checklist layout in "maintenance mode" or a slightly denser section editor once setup is complete.

