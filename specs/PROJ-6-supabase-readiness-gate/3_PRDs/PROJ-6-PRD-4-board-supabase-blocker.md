# PROJ-6-PRD-4: Board Supabase Blocker

## Status: Planned

## User Stories

### US-1: Als Browser Operator moechte ich auf dem Board erkennen dass ein Run wegen Supabase-Readiness blockiert ist um den Item-Kontext nicht zu verlieren
**Given** a DB-relevant run is blocked by Supabase pre-execution readiness  
**When** the workspace board renders the affected item  
**Then** the item shows a compact Supabase blocked-run state  
**And** the operator can open blocker details without leaving the board

**Acceptance Criteria:**
- [ ] AC-1: A Supabase-readiness-blocked run is visually distinct from generic failed or review-blocked states.
- [ ] AC-2: The blocker display preserves item title, workspace context, and run context.
- [ ] AC-3: The board card or item detail exposes a compact Supabase blocked-run panel.
- [ ] AC-4: The blocker panel does not render token/project paste inputs.
- [ ] AC-5: Empty board state or items without Supabase blockers do not show the Supabase blocker UI.

### US-2: Als Browser Operator moechte ich alle fehlenden Supabase-Aktionen im Blocker sehen um zu verstehen warum Start nicht weitergeht
**Given** the engine returns a Supabase readiness blocked payload  
**When** the board blocker panel opens  
**Then** it lists all relevant missing actions from the payload  
**And** it uses the same action vocabulary as CLI and workspace settings

**Acceptance Criteria:**
- [ ] AC-6: Missing token, missing project ref, missing branch, unauthorized token, and branch-not-ready states map to the same labels as PRD-1.
- [ ] AC-7: The panel names the affected workspace.
- [ ] AC-8: The panel explains that DB-relevant planned waves require Supabase readiness before execution.
- [ ] AC-9: Provider/auth errors show safe redacted messages before generic fallback copy.
- [ ] AC-10: The panel remains concise and does not duplicate full manual Supabase setup guidance.

### US-3: Als Browser Operator moechte ich direkt zu den richtigen Workspace Settings wechseln um nicht versehentlich den falschen Workspace zu konfigurieren
**Given** the blocked run belongs to workspace `alpha`  
**When** the operator clicks the repair action  
**Then** the UI navigates to `/w/alpha/settings#supabase`  
**And** configuring another workspace does not unblock this run

**Acceptance Criteria:**
- [ ] AC-11: The primary repair action deep-links to `/w/:key/settings#supabase` for the run workspace.
- [ ] AC-12: The link is built from server-provided workspace identity, not a client path field.
- [ ] AC-13: The blocker never links to app-global `/settings` as the primary Supabase repair destination.
- [ ] AC-14: If the workspace key is unavailable, the panel shows a safe error instead of guessing current workspace.

### US-4: Als Browser Operator moechte ich nach Setup den Run aus dem Blocker-Kontext erneut pruefen koennen um schnell weiterzuarbeiten
**Given** the operator returns from workspace settings after completing Supabase setup  
**When** the blocked run is ready to retry  
**Then** the board context offers retry for the same blocked run  
**And** if readiness is still blocked, the blocker refreshes with the updated action list

**Acceptance Criteria:**
- [ ] AC-15: Retry is disabled while the engine reports readiness blocked/checking.
- [ ] AC-16: Retry reuses the blocked `runId` semantics from PRD-1.
- [ ] AC-17: A retry that remains blocked updates the panel instead of creating duplicate blocker UI.
- [ ] AC-18: A successful retry removes or updates the Supabase blocker state once the run proceeds.

### US-5: Als Browser Operator moechte ich den Blocker auf Mobile lesen und bedienen koennen um Setup-Fehler auch auf schmalen Screens zu erkennen
**Given** the board is viewed at 375px width  
**When** a Supabase-readiness blocker is shown  
**Then** the blocker content, workspace settings link, and retry state remain readable and usable

**Acceptance Criteria:**
- [ ] AC-19: The compact blocker does not require horizontal scrolling at 375px.
- [ ] AC-20: Missing action labels wrap without overlapping adjacent content.
- [ ] AC-21: The workspace settings link remains visible and tappable.
- [ ] AC-22: A 375px screenshot is captured for the board blocker UI before QA can mark the UI wave green.

## Edge Cases

- Board loads while readiness is being checked: show loading/checking state, not a stale ready or failed label.
- Blocked payload lacks workspace key due to an engine bug: show safe error and do not guess.
- Multiple items are blocked in one workspace: each blocker links to the same workspace settings but keeps separate run context.
- User opens blocker after another tab fixed setup: recheck/refresh updates state rather than showing stale missing actions.
- Workspace settings is unavailable/offline: keep the blocker visible and show the navigation failure/error safely.

## Abhaengigkeiten

- Benoetigt: PROJ-6-PRD-1 readiness payload and same-run retry semantics.
- Benoetigt: PROJ-6-PRD-3 workspace settings route as the primary repair destination.

## UI Implementation Notes

- Project mode: brownfield.
- Reuse: `Board`, `ItemCard`, `BoardItemModal`, `AttentionDot`, `StatusChip`, existing blocked-run/review-gate visual language.
- New component candidates: `SupabaseBlockedRunPanel`.
- Design tokens: dark operator-console surfaces, amber warning panels, square bordered controls, `font-mono` for workspace/run identifiers.
- Interaction contract: compact blocker on board/item context; all missing actions visible; primary link to `/w/:key/settings#supabase`; no paste inputs in the blocker.
- Implementation tolerance: blocker may live on card, item modal, or both if it preserves compactness and links to workspace settings.

