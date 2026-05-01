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
- Evidence: The UI has a real shell, design language, active component tree, modal pattern, SSE architecture, and proxy pattern. Setup/settings still need new routes, navigation, form containers, and wizard/checklist patterns.
- Design/component gaps: no existing settings page, no setup wizard, no tabs/section navigation primitive, no form-heavy app-config surface, no drawer/sidepanel primitive, and no mobile setup pattern.

## Layout Decision To Make

- Should first-run setup be a linear wizard, a free-form checklist, or a hybrid guided checklist?
- Should properties reuse the setup shape or become a separate dense maintenance page?
- Should app-level setup/settings live outside workspace context or inside the existing workspace shell?

## Approaches

### A. Guided Sections

- Flow: User lands on `/setup`, sees a recommended step path, can jump between sections, but required blockers prevent completion. Each section owns one task: initialize, dependencies, app config, secrets, finish.
- Pros: Best first-run clarity, maps well to required/optional checks, supports deep links per step, avoids overwhelming new users.
- Cons: Less efficient for returning operators who want to edit one field quickly.
- Existing-fit: Reuses the operator-console tone and stepper/check vocabulary, but introduces a new setup container.
- Mobile: Strong fit because one active section can stack naturally.

### B. Readiness Dashboard

- Flow: User sees all readiness groups as cards, clicks a domain, edits or re-checks details below.
- Pros: Fast overview, good for returning users, makes optional areas visible without forcing sequence.
- Cons: Weaker first-run guidance; users may not know what to fix first.
- Existing-fit: Fits board/card scanning patterns and status chips.
- Mobile: Cards stack well, but long pages may become noisy.

### C. Split Control Center

- Flow: Left pane lists readiness groups and statuses; right pane shows the selected editor/check detail. Secret maintenance can open a drawer.
- Pros: Best shared shape for setup and properties; keeps readiness context visible while editing.
- Cons: Heavier layout and more custom interaction primitives than the app currently has.
- Existing-fit: Similar density to current modal detail, but introduces a split-pane and optional drawer.
- Mobile: Needs careful stacking; left pane becomes top navigation or section list.

### D. Existing Shell Extension

- Flow: Setup and Eigenschaften become app-level destinations in the current shell/navigation; topbar and workspace context remain visible.
- Pros: Minimal navigation invention and strongest continuity with the existing app.
- Cons: First-run "no workspace yet" feels awkward inside a workspace-oriented shell. Setup may look like a secondary page instead of the install handoff.
- Existing-fit: High, because it extends current shell and modal patterns.
- Mobile: Depends on future shell navigation; currently no mobile nav pattern is established.

## Trade-off Matrix

| Approach | Speed | Clarity | Complexity | Mobile fit | Existing fit | Risk |
|---|---:|---:|---:|---:|---:|---|
| A. Guided Sections | 4 | 5 | 3 | 5 | 3 | 2 |
| B. Readiness Dashboard | 4 | 3 | 2 | 4 | 4 | 3 |
| C. Split Control Center | 3 | 4 | 4 | 3 | 3 | 3 |
| D. Existing Shell Extension | 4 | 3 | 3 | 3 | 5 | 4 |

## Recommendation

Use **A. Guided Sections** for `/setup`, then use **C. Split Control Center** as the direction for the later app-level properties page.

The reason: the concept names first-time setup as the primary persona, and the user explicitly chose a hybrid flow. Approach A gives a clear path while preserving jumpability. Returning maintenance has different ergonomics: it benefits from persistent readiness context while editing, which Approach C handles better than a pure wizard.

This can still share underlying data, section definitions, and form components. The layout decision is not "two unrelated UIs"; it is one app-setup model expressed as first-run guidance and later maintenance.

## Shape Brief

- Primary job: help a new local user make beerengineer_ app-level setup ready, then let them maintain app-level properties and secrets later.
- User context: initially no workspace or incomplete setup; later a returning operator with a specific setting/token to update.
- Information shape: readiness groups, field-based app config, secret metadata, required/optional status, and remedy instructions.
- Interaction container: `/setup` as guided jumpable sections; properties as split readiness/editor surface.
- Existing components to preserve: Topbar branding, status chip/check language, modal discipline for short focused edits, API proxy boundary, sharp operator-console styling.
- New component candidates: setup section navigator, readiness checklist, config form field group, partial-save summary, secret metadata row, secret edit drawer or inline secret editor.
- Design constraints: low-fidelity here; final UI should remain dense and operational, avoid marketing onboarding, avoid hiding command remedies, and keep secret values redacted.
- Anti-goals: no automatic external tool installation, no workspace/project setup in v1, no SonarCloud project creation, no live engine-port migration.

## Conversation Notes

- Questions asked:
  - For first-run setup, should users be forced through a linear wizard or jump freely between setup sections?
- User answers:
  - Chose "C. Hybrid: guided recommended path, but sections are still jumpable."
- Assumptions:
  - The concept from `1_brainstorm/PROJ-2-concept.md` is accepted.
  - `/setup` should be optimized for first-time clarity.
  - Eigenschaften should optimize later maintenance, not duplicate every wizard affordance.
  - App-level setup/settings should remain separate from future workspace/project setup.

## Open Decisions For User

- Choose whether the final direction is:
  - A only: guided sections for both setup and properties.
  - C only: split control center for both setup and properties.
  - Recommended combination: A for setup and C for properties.
  - D hybridized: keep everything inside the current app shell.
- Decide whether secret editing should use an inline editor inside the selected section or a drawer-style secondary panel.
- Decide whether `/setup` should hide the workspace switcher entirely when no workspace exists or show a disabled/no-workspace topbar for continuity.

