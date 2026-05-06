# PROJ-6-PRD-4: Board Supabase Blocker

## Status: Planned

## User Stories

### US-1: Als Browser Operator moechte ich auf dem Board erkennen dass ein Run wegen Supabase-Readiness blockiert ist um den Item-Kontext nicht zu verlieren
**Given** a DB-relevant run is blocked by Supabase pre-execution readiness  
**When** the workspace board renders the affected item  
**Then** the item shows a compact Supabase blocked-run state  
**And** the operator can open blocker details without leaving the board

**Acceptance Criteria:**
- [ ] AC-1: A Supabase-readiness-blocked run uses an amber warning status chip with a database/branch-related icon and the label `Supabase blocked`.
- [ ] AC-2: The blocker marker is distinct from generic failed and review-blocked states by label and status variant, not color alone.
- [ ] AC-3: The blocker display preserves item title, workspace context, and run context.
- [ ] AC-4: The board card or item detail exposes a compact Supabase blocked-run panel.
- [ ] AC-5: The blocker panel does not render token/project paste inputs.
- [ ] AC-6: Empty board state or items without Supabase blockers do not show the Supabase blocker UI.

### US-2: Als Browser Operator moechte ich alle fehlenden Supabase-Aktionen im Blocker sehen um zu verstehen warum Start nicht weitergeht
**Given** the engine returns a Supabase readiness blocked payload  
**When** the board blocker panel opens  
**Then** it lists all relevant missing setup actions from the payload
**And** it uses the same missing setup action vocabulary as CLI and workspace settings

**Acceptance Criteria:**
- [ ] AC-7: Missing token, missing project ref, missing branch, invalid token, and unauthorized-project states map to exactly the PRD-1 missing setup action labels.
- [ ] AC-8: `Retry run` is shown only as a separate blocked-run affordance when retry is valid, not as a missing setup action.
- [ ] AC-9: Invalid/revoked/HTTP 401 token failures show `Rotate management token`; HTTP 403 permission-denied project access failures show `Re-authorize project access`.
- [ ] AC-10: The panel names the affected workspace.
- [ ] AC-11: The panel explains that DB-relevant planned waves require Supabase readiness before execution.
- [ ] AC-12: Provider/auth errors show safe redacted messages before generic fallback copy.
- [ ] AC-13: The panel remains concise and does not duplicate full manual Supabase setup guidance.

### US-3: Als Browser Operator moechte ich direkt zu den richtigen Workspace Settings wechseln um nicht versehentlich den falschen Workspace zu konfigurieren
**Given** the blocked run belongs to workspace `alpha`  
**When** the operator clicks the repair action  
**Then** the UI navigates to `/w/alpha/settings#supabase`  
**And** configuring another workspace does not unblock this run

**Acceptance Criteria:**
- [ ] AC-14: The primary repair action deep-links to `/w/:key/settings#supabase` for the run workspace.
- [ ] AC-15: The link is built from server-provided workspace identity, not a client path field.
- [ ] AC-16: The blocker never links to app-global `/settings` as the primary Supabase repair destination.
- [ ] AC-17: If the workspace key is unavailable, the panel shows a safe error instead of guessing current workspace.

### US-4: Als Browser Operator moechte ich nach Setup den Run aus dem Blocker-Kontext erneut pruefen koennen um schnell weiterzuarbeiten
**Given** the operator returns from workspace settings after completing Supabase setup  
**When** the blocked run is ready to retry  
**Then** the board context offers retry for the same blocked run  
**And** if readiness is still blocked, the blocker refreshes with the updated missing setup action list

**Acceptance Criteria:**
- [ ] AC-18: Retry is disabled while the engine reports readiness blocked/checking.
- [ ] AC-19: Retry reuses the blocked `runId` semantics from PRD-1.
- [ ] AC-20: A retry that remains blocked updates the panel instead of creating duplicate blocker UI.
- [ ] AC-21: Once readiness is ready and retry dispatch succeeds, the Supabase blocker panel is no longer rendered for that run; only the normal in-progress state is shown.

### US-5: Als Browser Operator moechte ich den Blocker auf Mobile lesen und bedienen koennen um Setup-Fehler auch auf schmalen Screens zu erkennen
**Given** the board is viewed at 375px width  
**When** a Supabase-readiness blocker is shown  
**Then** the blocker content, workspace settings link, and retry state remain readable and usable

**Acceptance Criteria:**
- [ ] AC-22: The compact blocker does not require horizontal scrolling at 375px.
- [ ] AC-23: Missing setup action labels wrap without overlapping adjacent content.
- [ ] AC-24: The workspace settings link remains visible and tappable.
- [ ] AC-25: A 375px screenshot is captured for the board blocker UI before QA can mark the UI wave green.

## Edge Cases

- Board loads while readiness is being checked: show loading/checking state, not a stale ready or failed label.
- Blocked payload lacks workspace key due to an engine bug: show safe error and do not guess.
- Multiple items are blocked in one workspace: each blocker links to the same workspace settings but keeps separate run context.
- User opens blocker after another tab fixed setup: recheck/refresh updates state rather than showing stale missing setup actions.
- Workspace settings is unavailable/offline: keep the blocker visible and show the navigation failure/error safely.

## Abhaengigkeiten

- Benoetigt: PROJ-6-PRD-1 readiness payload and same-run retry semantics.
- Benoetigt: PROJ-6-PRD-3 workspace settings route as the primary repair destination.

## UI Implementation Notes

- Project mode: brownfield.
- Reuse: `Board`, `ItemCard`, `BoardItemModal`, `AttentionDot`, `StatusChip`, existing blocked-run/review-gate visual language.
- New component candidates: `SupabaseBlockedRunPanel`.
- Design tokens: dark operator-console surfaces, amber warning panels, square bordered controls, `font-mono` for workspace/run identifiers.
- Interaction contract: compact blocker on board/item context; all missing setup actions visible; primary link to `/w/:key/settings#supabase`; no paste inputs in the blocker.
- Implementation tolerance: blocker may live on card, item modal, or both if it preserves compactness and links to workspace settings.

## QA Test Results

**Tested:** 2026-05-06  
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

- AC-1 through AC-25: PASS for the main board blocker behavior in browser/API QA and UI regression tests.
- Browser evidence: `/w/alpha` displayed `Supabase blocked`, preserved item/run context, showed the compact blocker panel, listed the PRD-1 action labels, did not render token/project inputs, kept retry disabled while blocked, and deep-linked to `/w/alpha/settings#supabase`.
- Mobile evidence: 375px board blocker screenshot captured as `proj6-qa-board-blocker-mobile-375.png`.

### Edge Cases Status

- Empty/non-blocked board items did not show Supabase blocker UI.
- Missing action labels wrapped in the compact panel at 375px without requiring blocker-local horizontal scrolling.
- Deep-link target usability has a Medium issue on the settings page after navigation.

### Security Audit Results

- [ ] BUG-PROJ6-QA-001: Retry and Supabase setup mutation proxies bypass the engine CSRF gate.
- [x] Board DTO did not expose Supabase Management token values.

### Bugs Found

- BUG-PROJ6-QA-001 — Critical — Next.js Supabase mutation proxies bypass the engine CSRF gate.
- BUG-PROJ6-QA-002 — Critical — PROJ-6 UI components are missing from the component registry.
- BUG-PROJ6-QA-003 — Medium — `/w/:key/settings#supabase` lands under the sticky topbar.
- BUG-PROJ6-QA-004 — Medium — Board and CLI derive Supabase setup actions by parsing human recovery summary text.
- BUG-PROJ6-QA-005 — Low — New blocker UI uses arbitrary font-size utilities outside the scale.

### Summary

- **Acceptance Criteria:** 25/25 functionally passed, with PROJ-level release blockers.
- **Bugs Found:** 5 relevant (2 Critical, 2 Medium, 1 Low).
- **Security:** Issues found.
- **Production Ready:** NO.
