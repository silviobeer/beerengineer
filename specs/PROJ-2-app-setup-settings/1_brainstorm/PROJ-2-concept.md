# PROJ-2 Concept: App Setup and Settings

## Summary

beerengineer_ needs an app-level setup wizard and an app-level properties page in the UI. The first-run wizard should guide a new user from a fresh managed install toward a ready local beerengineer_ app. The properties page should let the same user return later to inspect readiness, edit app-level settings, and maintain local secrets.

This project covers beerengineer_ app setup only. Workspace and project setup remain separate future work, even when the wizard eventually links into that flow.

## Goals

- Provide a first-run `/setup` wizard that can initialize app state, show readiness, save app-level configuration, manage local secrets, and re-run checks.
- Provide an app-level properties page for later changes to settings and secrets.
- Keep the existing `doctor` model as the source of readiness truth while extending it for UI-driven setup.
- Preserve the existing separation between app config, workspace config, repo files, and operator-local secrets.
- Make setup understandable for users who installed beerengineer_ successfully but do not yet know which tools, auth states, and local settings are missing.

## Success Criteria

- A first-time user can open the UI after install and reach the setup wizard.
- If app config, data directory, or the SQLite database are missing, the UI can trigger app-state initialization through the engine.
- Required dependencies block progress with precise install or login guidance and a re-check action.
- At least one AI harness path can be verified as ready before setup is considered complete.
- GitHub readiness is checked. If `gh` is missing or unauthenticated, the UI explains how to install or run `gh auth login`.
- Sonar and Telegram are visible as optional app-level capabilities. Users can skip them, but the UI and API support their app-level readiness and secret maintenance.
- Secrets such as `SONAR_TOKEN` can be entered, tested, replaced, disabled, and deleted from the UI without ever showing stored values.
- The properties page can edit app-level settings after initial setup and report partial-save results clearly.

## User Personas and Scenarios

### Primary Persona: First-Time Local User

The primary user has just installed beerengineer_ and wants to get to a usable local setup without understanding the CLI internals. They open the UI after the installer starts it or prints the URL. They expect the UI to tell them what is missing, what is optional, and what exact action to take next.

Scenario:

1. The installer starts or points the user to the UI.
2. The UI opens `/setup` because setup is incomplete or no workspace exists.
3. The wizard initializes app state if needed.
4. The wizard checks required tooling and auth.
5. The user fixes missing items in a terminal using UI-provided guidance.
6. The user clicks re-check until required groups pass.
7. The user optionally configures GitHub, Sonar-related secrets, browser support, or Telegram.
8. The user leaves the wizard with app setup complete and ready for a later workspace/project setup flow.

### Secondary Persona: Returning Operator

The returning operator already uses beerengineer_ and needs to update an expired token, change `publicBaseUrl`, enable Telegram, or inspect why a readiness check is failing. They use the properties page, not the first-run wizard.

## Scope

### In Scope

- App-level setup wizard at `/setup`.
- App-level properties/settings surface.
- Engine API support for reading effective app config.
- Engine API support for app-state initialization.
- Engine API support for partial app-config updates with field-level validation.
- Local engine-owned secret store outside the repo and outside normal app config.
- Secret status, replace, test, disable, reactivate, and delete flows.
- Doctor/setup checks that can read secrets from the local secret store as well as process environment when appropriate.
- UI entry when the installer can open the UI, when setup is blocked, when no workspace exists, and through a visible setup/settings navigation entry.
- App-level editable fields:
  - `allowedRoots`
  - `enginePort`
  - `publicBaseUrl`
  - default LLM provider/model/harness profile
  - GitHub enabled
  - browser enabled
  - Telegram enabled and message level
  - secret references and secret values through the secret store

### Out of Scope

- Automatic installation of external tools such as Node.js, Git, Claude Code, Codex, OpenCode, Sonar scanner, or GitHub CLI.
- Live port migration for the currently running engine after `enginePort` changes.
- Workspace/project setup and workspace/project properties.
- Per-workspace Sonar project setup, generated `sonar-project.properties`, preview commands, Git settings, or harness overrides.
- Creating or importing SonarCloud projects through the Sonar API.
- Persisting secret values in `.env.local`, repo files, workspace files, or normal app `config.json`.
- Full OS keychain integration in v1.

## Product Decisions

### Setup Entry

The preferred entry is automatic handoff after install: the installer starts or opens the UI when possible, and the UI lands on the setup wizard. When the installer cannot open the UI reliably, it prints the URL and command. The wizard is also reachable when setup is blocked, when no workspace exists, and through a visible setup/properties entry.

### Required Versus Optional Checks

Required checks block the wizard's next step until fixed. The UI shows exact install/login guidance and a re-check button. Recommended and optional checks can be skipped by the user while remaining visible as incomplete.

### Partial Saves

The properties page accepts partial saves. Valid fields are persisted; invalid fields remain unchanged, stay visible with field-level errors, and the page stays open. The UI shows a summary such as "changes partially saved" instead of redirecting or silently ignoring invalid input.

### Engine Port

Changing `enginePort` saves the future-start value only. The running engine continues on its current port. The UI must communicate that the new port becomes active after an engine restart.

### Secrets

The app config stores references and metadata, not secret values. Secret values live in a new engine-owned local secret store under an OS-aware beerengineer state or data path with restrictive file permissions.

Stored secret values are never displayed in the UI. The UI can show whether a value exists, whether it is active, when it was last tested, and whether it is suspected or known invalid.

Only explicit setup/settings tests can automatically disable an invalid secret. Runtime failures may mark a secret as suspicious, but they do not disable it, because network failures, service outages, or rate limits should not switch off valid credentials. Disabled secrets are retained until the user replaces, reactivates, or deletes them.

## Architecture

### Engine

The engine remains the owner of setup state and app config. New app-setup routes should sit beside the existing setup route and reuse existing config validation, `doctor`, and setup primitives where possible.

Expected capabilities:

- Read effective app config with secret values redacted.
- Initialize app config, data directory, and database when missing.
- Patch app config with field-level validation and partial success reporting.
- Manage local secrets through named references.
- Run or re-run setup/doctor checks and return the existing `SetupReport` shape.
- Inject secret-store values into the environment for controlled checks and future tool execution when a feature explicitly needs them.

The existing `GET /setup/status` remains the readiness report. New mutating routes must be CSRF-protected like other engine writes.

### UI

The UI must respect the existing boundary: browser code does not call mutating engine routes directly. All writes go through `apps/ui/app/api/**` route handlers so the Next.js server can attach the engine CSRF token.

The wizard and properties page should share data-loading and form primitives where practical, but their product posture differs:

- Wizard: guided, linear, first-run, blocks on required checks.
- Properties: editable control surface, supports partial saves and repeated maintenance.

### Secret Store

The first implementation should use a local file-backed secret store controlled by the engine. It should be outside registered workspaces and repo files, use restrictive permissions, and expose only redacted metadata through HTTP.

The concept intentionally leaves room for later OS keychain support without requiring it in v1.

## Data Flow

1. UI loads workspaces and setup status.
2. If setup is incomplete, blocked, or no workspace exists, the user is guided to `/setup`.
3. `/setup` requests effective config and setup status.
4. If app state is uninitialized, the user can trigger initialization.
5. Wizard steps patch app config and secrets through UI API routes that proxy to CSRF-protected engine routes.
6. Wizard re-runs setup status after each meaningful change.
7. Properties uses the same config/status/secret endpoints for later maintenance.

## Error Handling

- Missing tools show a failed check, a human explanation, and a remedy command or URL when available.
- Missing auth shows the required login or token action, such as `gh auth login`.
- Invalid fields stay on screen with field-level messages.
- Partial saves report both persisted fields and rejected fields.
- Secret tests distinguish missing value, invalid value, disabled value, and unknown/transient failure when the underlying check can make that distinction.
- Engine/config unavailability is shown as an app-level blocker with a recovery action or CLI fallback.

## Testing Strategy

### Engine Tests

- Config initialization creates config, data directory, and SQLite state without overwriting invalid existing config.
- Partial config patch persists valid fields and rejects invalid fields without corrupting the prior config.
- `enginePort` changes are stored as future-start changes.
- Secret store creates files outside repo/workspace paths with restrictive permissions.
- Secret metadata redacts values.
- Secret replace/test/disable/reactivate/delete operations behave deterministically.
- Doctor checks can consume secret-store values where appropriate.
- Mutating setup routes require CSRF token.

### UI Tests

- First-run wizard appears for incomplete setup/no workspace states.
- Required check failures block forward progress and render remedies.
- Optional Sonar/Telegram paths can be skipped.
- GitHub unauthenticated state shows login guidance and re-check.
- Properties partial save stays on the page and shows per-field errors.
- Secret actions never reveal stored values and update status after test/replace/delete.
- Engine unreachable/config unavailable states are understandable and recoverable.

## Risks and Follow-Ups

- The local file-backed secret store is intentionally simpler than OS keychain support. A future project can add keychain providers behind the same engine abstraction.
- Installer-to-UI auto-open depends on host capabilities. The acceptable v1 fallback is printing the URL and command.
- Workspace/project setup is deliberately postponed. This concept should not grow per-workspace Sonar, Git, preview, or harness editing in v1.
- Runtime tool failures should be careful when marking secrets suspicious, because transient service failures are common.

