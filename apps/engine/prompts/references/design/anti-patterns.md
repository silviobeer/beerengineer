<!-- Inspired by pbakaus/impeccable (Apache-2.0): https://github.com/pbakaus/impeccable -->
# Design Anti-Patterns

Use this as a selection bank, not a checklist to dump wholesale. Pick the entries that fit the product tone, then add item-specific risks the bank does not cover.

## Typography

- Avoid defaulting both display and body to the same safe sans family. Distinct roles create hierarchy and help the UI feel intentional.
- Avoid whisper-light muted text for core labels or body copy. Low-contrast typography looks polished in isolation and fails under real content.
- Avoid oversized display treatment on dense operator screens. Big headline energy can steal space from the information the screen exists to surface.

## Color And Contrast

- Avoid the familiar "single violet accent on off-white" palette unless the brief explicitly wants it. That default drifts toward interchangeable AI-generated product pages.
- Avoid using tinted gray for every surface and separator. Too many near-neutral layers flatten the hierarchy instead of clarifying it.
- Avoid relying on color alone to differentiate states. Status, urgency, and validation should survive for users with poor contrast or color-vision variance.

## Spatial Design

- Avoid card-inside-card nesting when the content is already grouped by the page layout. Extra containers add softness and visual noise without adding structure.
- Avoid equal spacing for everything. Rhythm should show what is grouped, what is secondary, and what deserves breathing room.
- Avoid decorative empty space that pushes primary actions below the fold on common laptop widths. Spacious is only useful when it still serves the task.

## Motion

- Avoid bouncy easing or playful overshoot on serious operator workflows. Motion should support confidence, not make the interface feel toy-like.
- Avoid animating every interaction. Reserve motion for orientation, feedback, and state change that benefits from it.

## Interaction

- Avoid tiny hit targets hidden inside dense surfaces. The user should not need pixel precision to move through the primary flow.
- Avoid icon-only controls when the action is not obvious from context. Ambiguous controls slow down first use and create support debt.
- Avoid hover-only affordances for critical actions. Keyboard and touch users need the same path to the important controls.

## Responsive Design

- Avoid desktop spacing and column counts collapsing unchanged onto narrow screens. Mobile layouts need reprioritization, not just compression.
- Avoid burying primary actions behind secondary chrome on smaller breakpoints. The key action should remain visible without hunting.

## UX Writing

- Avoid generic empty-state copy such as "Nothing here yet" without context. Empty states should explain what is missing and what the user can do next.
- Avoid vague CTA labels like "Submit" or "Continue" when a more specific verb is available. Clear verbs reduce hesitation.
- Avoid system language that sounds like internal tooling unless the audience is actually internal operators. Voice should fit the product and user.
