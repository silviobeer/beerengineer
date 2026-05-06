# PROJ-6 Wave 5 Implementation Plan

**Goal:** Surface Supabase readiness blockers on existing board/item UI and link operators to the workspace settings repair page.
**Architecture Reference:** `6_plan/PROJ-6-architecture.md`
**PRDs involved:** PROJ-6-PRD-4

---

## Wave Position

- **Previous waves:** Wave 4 - workspace settings repair surface complete.
- **Next waves:** None.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-6-PRD-4-US-1 | full-stack | fullstack-implementer | sonnet | after Wave 4 |
| PROJ-6-PRD-4-US-2 | full-stack | fullstack-implementer | sonnet | after Wave 4 |
| PROJ-6-PRD-4-US-3 | frontend | frontend-implementer | sonnet | after Wave 4 |
| PROJ-6-PRD-4-US-4 | full-stack | fullstack-implementer | sonnet | after PRD-4-US-2 |
| PROJ-6-PRD-4-US-5 | frontend | frontend-implementer | sonnet | after PRD-4-US-1 |

The board blocker should be compact and must not duplicate workspace settings setup inputs.

---

## PROJ-6-PRD-4-US-1: Als Browser Operator moechte ich auf dem Board erkennen dass ein Run wegen Supabase-Readiness blockiert ist um den Item-Kontext nicht zu verlieren
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-1: A Supabase-readiness-blocked run uses an amber warning status chip with a database/branch-related icon and the label `Supabase blocked`.
- [ ] AC-2: The blocker marker is distinct from generic failed and review-blocked states by label and status variant, not color alone.
- [ ] AC-3: The blocker display preserves item title, workspace context, and run context.
- [ ] AC-4: The board card or item detail exposes a compact Supabase blocked-run panel.
- [ ] AC-5: The blocker panel does not render token/project paste inputs.
- [ ] AC-6: Empty board state or items without Supabase blockers do not show the Supabase blocker UI.

**Smoke Test:**
- Route: `/w/alpha`
- Verify: "A Supabase-readiness-blocked item shows an amber `Supabase blocked` marker and compact blocker panel without token/project inputs."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/board-blocked-run.html`
- Selected direction: compact board/item blocker plus deep link to workspace settings.
- Reuse: `Board`, `BoardCard`, `ItemCard`, `BoardItemModal`, `AttentionDot`, `StatusChip`.
- Create new: `SupabaseBlockedRunPanel`.
- Design tokens: dark board surfaces, amber warning panels, square controls, `font-mono` for workspace/run identifiers.
- Interaction contract: board blocker preserves item context and sends repair to workspace settings.
- Implementation tolerance: blocker may live on card, item modal, or both if compact.

### Task 5.1: Board DTO And Compact Marker
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

**Files:**
- Modify: `apps/engine/src/api/board.ts`
- Modify: `apps/ui/lib/types.ts`
- Modify: `apps/ui/app/w/[key]/page.tsx`
- Modify: `apps/ui/components/BoardCard.tsx`
- Create: `apps/ui/components/SupabaseBlockedRunPanel.tsx`
- Test: `apps/engine/test/apiIntegration.test.ts`
- Test: `apps/ui/tests/BoardCard.test.tsx`
- Test: `apps/ui/tests/SupabaseBlockedRunPanel.test.tsx`

**What to build:** Expose Supabase readiness blocker metadata in board DTOs and render a compact distinct marker/panel without any setup input fields.

**Components (UI tasks only - mandatory):**
- Reuse: `BoardCard`, `StatusChip`, `AttentionDot`, board card language.
- Create new: `SupabaseBlockedRunPanel` - no existing panel lists Supabase readiness actions while preserving board context.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: compact blocker, no paste inputs, amber warning panel.
- May approximate: exact panel placement between card and modal.
- Must not change without user approval: setup inputs remain only in workspace settings.

**TDD cycle:**
- RED: engine DTO test verifies blocked metadata; UI tests verify marker, panel, no inputs, and absence for normal items.
- GREEN: implement DTO normalization and compact UI marker.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-4): implement supabase board blocker marker`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-4-US-2: Als Browser Operator moechte ich alle fehlenden Supabase-Aktionen im Blocker sehen um zu verstehen warum Start nicht weitergeht
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-7: Missing token, missing project ref, missing branch, invalid token, and unauthorized-project states map to exactly the PRD-1 missing setup action labels.
- [ ] AC-8: `Retry run` is shown only as a separate blocked-run affordance when retry is valid, not as a missing setup action.
- [ ] AC-9: Invalid/revoked/HTTP 401 token failures show `Rotate management token`; HTTP 403 permission-denied project access failures show `Re-authorize project access`.
- [ ] AC-10: The panel names the affected workspace.
- [ ] AC-11: The panel explains that DB-relevant planned waves require Supabase readiness before execution.
- [ ] AC-12: Provider/auth errors show safe redacted messages before generic fallback copy.
- [ ] AC-13: The panel remains concise and does not duplicate full manual Supabase setup guidance.

**Smoke Test:**
- Route: `/w/alpha`
- Verify: "The blocker panel lists the missing setup actions, names workspace alpha, and shows provider messages before fallback copy."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/board-blocked-run.html`
- Selected direction: compact action list with details kept short.
- Reuse: `StatusChip`, `SupabaseReadinessSummary` label vocabulary where practical.
- Create new: `SupabaseBlockedRunPanel`.
- Design tokens: amber warning panels and mono identifiers.
- Interaction contract: retry is separate from setup action labels.
- Implementation tolerance: panel copy may be concise if exact labels remain.

### Task 5.2: Blocker Action List And Message Projection
**Fulfills:** AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13

**Files:**
- Modify: `apps/engine/src/api/board.ts`
- Modify: `apps/ui/components/SupabaseBlockedRunPanel.tsx`
- Test: `apps/engine/test/apiIntegration.test.ts`
- Test: `apps/ui/tests/SupabaseBlockedRunPanel.test.tsx`

**What to build:** Project missing setup actions, workspace name, DB-relevance explanation, safe provider messages, and separate retry affordance into the compact blocker panel.

**Components (UI tasks only - mandatory):**
- Reuse: `StatusChip`, `SupabaseReadinessSummary` label vocabulary.
- Create new: `SupabaseBlockedRunPanel` as introduced in Task 5.1.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: all missing setup actions visible in compact panel.
- May approximate: exact secondary explanatory copy.
- Must not change without user approval: no full manual setup tutorial in board blocker.

**TDD cycle:**
- RED: tests cover exact action labels, provider message precedence, workspace naming, and concise no-tutorial rendering.
- GREEN: implement projection and rendering.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-4): implement supabase blocker action list`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-4-US-3: Als Browser Operator moechte ich direkt zu den richtigen Workspace Settings wechseln um nicht versehentlich den falschen Workspace zu konfigurieren
**Scope:** frontend -> frontend-implementer

**Acceptance Criteria:**
- [ ] AC-14: The primary repair action deep-links to `/w/:key/settings#supabase` for the run workspace.
- [ ] AC-15: The link is built from server-provided workspace identity, not a client path field.
- [ ] AC-16: The blocker never links to app-global `/settings` as the primary Supabase repair destination.
- [ ] AC-17: If the workspace key is unavailable, the panel shows a safe error instead of guessing current workspace.

**Smoke Test:**
- Route: `/w/alpha`
- Verify: "The primary repair action points to `/w/alpha/settings#supabase`; there is no app-global `/settings` repair link."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/board-blocked-run.html`
- Selected direction: board links to workspace settings.
- Reuse: `SupabaseBlockedRunPanel`.
- Create new: none beyond `SupabaseBlockedRunPanel`.
- Design tokens: existing link/button language.
- Interaction contract: link built from engine/server workspace identity.
- Implementation tolerance: error copy can vary if it is safe and does not guess.

### Task 5.3: Workspace Settings Deep Link
**Fulfills:** AC-14, AC-15, AC-16, AC-17

**Files:**
- Modify: `apps/ui/components/SupabaseBlockedRunPanel.tsx`
- Modify: `apps/ui/lib/types.ts`
- Test: `apps/ui/tests/SupabaseBlockedRunPanel.test.tsx`

**What to build:** Link blockers to the engine-provided workspace key settings URL and render a safe error when workspace identity is missing.

**Components (UI tasks only - mandatory):**
- Reuse: `SupabaseBlockedRunPanel`.
- Create new: none.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: primary action links to `/w/:key/settings#supabase`.
- May approximate: button vs link styling as long as it is visible and tappable.
- Must not change without user approval: no app-global settings repair fallback.

**TDD cycle:**
- RED: tests verify workspace deep link, no `/settings` repair target, and safe missing-key handling.
- GREEN: implement deep link rendering.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-4): implement supabase settings deep link`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-4-US-4: Als Browser Operator moechte ich nach Setup den Run aus dem Blocker-Kontext erneut pruefen koennen um schnell weiterzuarbeiten
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-18: Retry is disabled while the engine reports readiness blocked/checking.
- [ ] AC-19: Retry reuses the blocked `runId` semantics from PRD-1.
- [ ] AC-20: A retry that remains blocked updates the panel instead of creating duplicate blocker UI.
- [ ] AC-21: Once readiness is ready and retry dispatch succeeds, the Supabase blocker panel is no longer rendered for that run; only the normal in-progress state is shown.

**Smoke Test:**
- Route: `/w/alpha`
- Verify: "Retry is disabled while blocked, uses the same run when ready, updates the panel if still blocked, and disappears after successful dispatch."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/board-blocked-run.html`
- Selected direction: retry from board context after setup, still compact.
- Reuse: `SupabaseBlockedRunPanel`, existing run/item action proxy patterns.
- Create new: none beyond `SupabaseBlockedRunPanel`.
- Design tokens: existing button disabled/active states.
- Interaction contract: same-run retry; no duplicate blocker panels.
- Implementation tolerance: exact in-progress copy may follow existing board language.

### Task 5.4: Board Retry State
**Fulfills:** AC-18, AC-19, AC-20, AC-21

**Files:**
- Modify: `apps/ui/components/SupabaseBlockedRunPanel.tsx`
- Modify: `apps/ui/components/Board.tsx`
- Modify: `apps/ui/app/api/runs/[id]/supabase-readiness/retry/route.ts`
- Test: `apps/ui/tests/SupabaseBlockedRunPanel.test.tsx`
- Test: `apps/ui/tests/Board.test.tsx`
- Test: `apps/engine/test/api/routes/supabaseReadinessRetry.test.ts`

**What to build:** Wire board-context retry to the same-run retry endpoint, keep retry disabled until ready, refresh still-blocked payloads, and remove the blocker after successful dispatch.

**Components (UI tasks only - mandatory):**
- Reuse: `SupabaseBlockedRunPanel`, `Board`.
- Create new: none.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: retry is tied to same blocked run.
- May approximate: exact loading label.
- Must not change without user approval: no new run creation for retry.

**TDD cycle:**
- RED: tests cover disabled retry, same-run retry call, still-blocked update, and successful disappearance.
- GREEN: implement retry behavior.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-4): implement board supabase retry`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-4-US-5: Als Browser Operator moechte ich den Blocker auf Mobile lesen und bedienen koennen um Setup-Fehler auch auf schmalen Screens zu erkennen
**Scope:** frontend -> frontend-implementer

**Acceptance Criteria:**
- [ ] AC-22: The compact blocker does not require horizontal scrolling at 375px.
- [ ] AC-23: Missing setup action labels wrap without overlapping adjacent content.
- [ ] AC-24: The workspace settings link remains visible and tappable.
- [ ] AC-25: A 375px screenshot is captured for the board blocker UI before QA can mark the UI wave green.

**Smoke Test:**
- Route: `/w/alpha`
- Verify: "At 375px width, the Supabase blocker wraps labels, keeps the workspace settings link visible, and avoids horizontal scrolling."

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/board-blocked-run.html`
- Selected direction: compact board/item blocker.
- Reuse: `BoardCard`, `BoardItemModal`, `SupabaseBlockedRunPanel`.
- Create new: none beyond `SupabaseBlockedRunPanel`.
- Design tokens: square bordered amber panel.
- Interaction contract: repair happens on settings page; board remains compact.
- Implementation tolerance: exact mobile spacing may differ if controls remain usable.

### Task 5.5: Mobile Blocker Polish
**Fulfills:** AC-22, AC-23, AC-24, AC-25

**Files:**
- Modify: `apps/ui/components/SupabaseBlockedRunPanel.tsx`
- Modify: `apps/ui/components/BoardCard.tsx`
- Test: `apps/ui/tests/SupabaseBlockedRunPanel.test.tsx`

**What to build:** Ensure the blocker wraps action labels, keeps the settings link tappable, and remains horizontally safe at 375px for QA screenshot capture.

**Components (UI tasks only - mandatory):**
- Reuse: `SupabaseBlockedRunPanel`, `BoardCard`.
- Create new: none.

**UI handoff constraints (UI tasks only - mandatory):**
- Follow: compact board blocker; no second setup surface.
- May approximate: exact spacing from mockup.
- Must not change without user approval: repair link remains visible on mobile.

**TDD cycle:**
- RED: responsive render test verifies labels and link are present without hidden overflow-prone structure.
- GREEN: implement responsive polish.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-4): polish mobile supabase blocker`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
