# PROJ-3 Capability Architecture Concept

## Summary

PROJ-3 introduces an explicit capability architecture for workspace and
review integrations. The initial capabilities are `git`, `github`,
`sonar`, and `coderabbit`.

The goal is good code before more features: integrations should have clear
module boundaries, predictable operator commands, and a structure that a
maintainer can understand quickly. A maintainer should be able to find a
capability entry point, understand what the capability owns, and see how to
remove or replace it without reading unrelated workspace, CLI, and review
internals.

This is not a generic plugin framework. Capabilities are concrete, typed
engine units with explicit ports that match real product flows.

## Personas And Usage Scenarios

### Maintainer / Developer

The maintainer needs to understand, change, replace, or remove integrations
without chasing special cases through `workspace`, `review`, CLI parsing, and
setup code.

Primary scenario: a developer opens the codebase and can find all Sonar,
CodeRabbit, GitHub, or Git capability logic through a clear entry point. Sonar
and CodeRabbit do not interpret GitHub remotes or `gh` state directly; they
consume Git/GitHub context through ports.

### Operator / CLI User

The operator needs clear commands and clear review feedback.

Primary scenarios:

- During workspace onboarding, the operator sees Git, GitHub, Sonar, and
  CodeRabbit as understandable capability checks instead of mixed preflight
  logic.
- After onboarding, the operator can run explicit capability commands such as
  `workspace sonar audit` or `workspace sonar repair`.
- After a story review, the operator can tell which review capabilities ran,
  which were skipped, and which results were not meaningful.

## Capability Model

Capabilities use stable IDs:

- `git`
- `github`
- `sonar`
- `coderabbit`

The architecture uses typed explicit ports, not a dynamic plugin lifecycle.
Each capability implements only the ports that make sense for it.

Capability ports:

- `preflight(workspace)` for readiness and context.
- `enable` or `connect` for capabilities that can be activated or connected.
- `audit(workspace)` for drift-capable configuration.
- `repair(workspace, plan)` for deterministic operator-controlled repair.
- `review(input)` for review capabilities.

Classification:

- `git` is the local core capability. It is mandatory for normal workspace and
  story flows.
- `github` is the provider capability. It owns GitHub remote context and `gh`
  usage. It is mandatory only for flows that need GitHub actions such as repo
  creation, remote operations, authentication checks, or PR-related work.
- `sonar` is an optional review and quality-scope capability.
- `coderabbit` is an optional review capability.

## Components

The new core should live under a clear capability area, for example:

```text
apps/engine/src/core/capabilities/
```

Expected component boundaries:

- `core/capabilities/types.ts`: common capability IDs, result envelopes, and
  port contracts.
- `core/capabilities/git/`: local repository, branch, worktree, commit, and
  diff context.
- `core/capabilities/github/`: GitHub remote parsing, owner/repo/default
  branch context, `gh` availability/auth, repo/remote actions.
- `core/capabilities/sonar/`: Sonar enablement, config generation,
  quality-scope audit, repair plan, safe apply, scanner/token/coverage
  readiness, and review adapter.
- `core/capabilities/coderabbit/`: CodeRabbit CLI readiness, workspace
  configuration, and review adapter.
- `core/capabilities/readiness/`: shared GitHub and Sonar readiness terms and
  helper checks reused by workspace capabilities and update-mode without
  sharing workspace orchestration.

Existing mixed modules should be reduced to orchestration:

- `core/workspaces/registration.ts` orchestrates workspace registration and
  calls capability ports.
- `core/workspaces/sonar.ts` is split into Sonar-owned modules.
- `review/registry.ts` becomes a review-capability orchestrator.
- `cli/commands/workspaces.ts` loses tool-specific special cases.

The CLI gets dedicated command modules for the public groups:

- `workspace git ...`
- `workspace github ...`
- `workspace sonar ...`
- `workspace coderabbit ...`

## Data Flow

Workspace onboarding starts with local Git context. If a flow needs GitHub,
the GitHub capability derives provider context from the remote and `gh` state.
Registration then passes the relevant context to Sonar and CodeRabbit through
ports instead of letting those tools inspect remotes or `gh` themselves.

`workspace add --sonar` remains a convenience path, but it delegates to the
same Sonar enablement core as `workspace sonar enable`.

Capability write boundaries:

- Git writes only local Git state required by the workspace flow.
- GitHub writes only GitHub/remote state and related metadata.
- Sonar writes Sonar-owned artifacts such as `sonar-project.properties`,
  Sonar-specific workspace metadata, and any existing Sonar workflow artifacts
  that remain part of current behavior.
- CodeRabbit writes only CodeRabbit-owned configuration artifacts.

Story review calls review capabilities through a review orchestrator. Each
review capability returns a small common orchestration envelope:

- `capabilityId`
- lifecycle or phase
- outcome
- blocking flag
- summary
- artifact paths

The domain result remains tool-specific. Sonar keeps scanner, gate, condition,
scope, and coverage semantics. CodeRabbit keeps diff and finding semantics.
The common envelope is only for orchestration and presentation.

Update-mode remains a beerengineer self-update flow. It does not become a
workspace capability consumer. It uses shared readiness terms and helper
checks for GitHub and Sonar so those definitions do not drift from workspace
capability checks.

## Error Handling And CLI

Public CLI commands use dedicated groups with the same stable IDs as the
internal capability IDs. This project does not add a generic
`workspace capability ...` command.

JSON output includes:

- `capabilityId`
- status or outcome
- summary
- tool-specific details

Blocking rules:

- Missing local Git may block or fail flows that require a real workspace or
  story run.
- GitHub/`gh` may block only flows that need GitHub-specific actions.
- Sonar and CodeRabbit do not block story flows when disabled, not configured,
  missing, or not meaningful. The review result documents the reason and
  artifact path.

Sonar repair rules:

- `workspace sonar audit` reports current scope and drift.
- `workspace sonar repair` prints a repair plan without writing files.
- `workspace sonar repair --apply` writes only safe deterministic repairs.
- Risky or ambiguous suggestions remain visible and are not applied.

Exit codes should distinguish usage errors, required capability failures, and
optional capability warnings.

## Success Criteria

The project is successful when:

- Workspace registration and preflight call Git, GitHub, Sonar, and CodeRabbit
  through capability ports.
- Story review calls Sonar and CodeRabbit through review-capability ports.
- Sonar and CodeRabbit issues are documented as skipped, not configured, or
  not meaningful without blocking story flows.
- Git blocks where local Git context is mandatory.
- GitHub/`gh` blocks only GitHub-dependent actions.
- `workspace add --sonar` and `workspace sonar enable` delegate to the same
  Sonar core.
- `workspace sonar audit`, `workspace sonar repair`, and
  `workspace sonar repair --apply` exist with JSON and text output.
- `repair --apply` modifies only safe deterministic repairs.
- Public CLI groups and JSON output use stable `capabilityId` values.
- Update-mode uses shared readiness terminology and helpers where relevant,
  while remaining outside workspace capability orchestration.
- Existing UI setup/settings flows continue working through compatible API
  behavior or minimal API/UI compatibility adjustments.

## Out Of Scope

Out of scope:

- New UI or settings surfaces.
- UI/Settings UX expansion beyond compatibility adjustments needed to preserve
  existing flows.
- Notifications and Telegram.
- Secret-store architecture changes.
- LLM harness or runtime changes.
- General workspace DB or workflow-orchestrator refactors without capability
  relevance.
- New SonarCloud, CodeRabbit, or GitHub product functions that are not needed
  for the migration.
- A generic plugin framework.
- A generic dynamic capability CLI.

## Test Strategy

Tests must protect behavior and architecture, not just parsing shapes.

Required test coverage:

- Unit tests for capability port implementations and classification.
- Parser and command-runner tests for dedicated CLI groups.
- Public CLI acceptance tests for `workspace sonar audit`, `repair`, and
  `repair --apply` with real file side effects.
- Review orchestrator tests with fake Sonar and CodeRabbit capabilities.
- Regression tests proving optional Sonar/CodeRabbit failures are documented
  and do not block story flows.
- Tests proving mandatory Git failures block Git-dependent flows.
- Tests proving GitHub/`gh` failures block only GitHub-dependent actions.
- Update-readiness regression tests for shared GitHub/Sonar readiness helpers.

## Relationship To Existing Sonar Lifecycle Spec

This PROJ absorbs the intent of
`specs/sonar-workspace-quality-lifecycle.md` into the broader capability
architecture.

Sonar still needs:

- generated initial quality scope;
- drift audit;
- repair suggestions;
- explicit safe repair application;
- review-time documentation when the scan is skipped or not meaningful;
- future rebaseline support when a promotion flow exists.

The difference is that Sonar lifecycle behavior is now implemented as one
capability, not as special logic spread through workspace registration, CLI,
and review code.
