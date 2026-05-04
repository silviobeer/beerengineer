# PROJ-3 Capability Architecture Concept

## Summary

PROJ-3 introduces an explicit capability architecture for workspace and
review integrations. The initial capabilities are `git`, `github`,
`sonar`, and `coderabbit`.

The goal is good code before more features: integrations have clear module
boundaries, predictable operator commands, and a structure that a maintainer
can understand quickly. A maintainer can find a capability entry point,
understand what the capability owns, and see how to remove or replace it
without reading unrelated workspace, CLI, and review internals.

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

- `available(workspace)` for cheap local availability. It answers whether the
  capability can participate in the workspace without performing expensive
  readiness work.
- `preflight(workspace)` for detailed readiness and context. It returns
  structured data and diagnostics instead of throwing for normal missing,
  disabled, or not-configured states. It throws only for programming errors or
  unreadable inputs that prevent producing a report.
- `enable(input)` for capabilities that activate local project configuration,
  such as Sonar.
- `connect(input)` for capabilities that establish provider or tool context,
  such as GitHub/`gh`.
- `audit(workspace)` for drift-capable configuration. It returns drift as data
  with risk classification, not as control-flow exceptions.
- `repair(workspace, plan)` for deterministic operator-controlled repair. It is
  idempotent for safe repairs: rerunning after a partial or completed apply
  recomputes the current plan and only writes remaining safe changes.
- `review(input)` for review capabilities.

Classification:

- `git` is the local core capability. It is mandatory for normal workspace and
  story flows.
- `github` is the provider capability. It owns GitHub remote context and `gh`
  usage. It is mandatory only for flows that need GitHub actions such as repo
  creation, remote operations, authentication checks, or PR-related work.
- `sonar` is an optional review and quality-scope capability.
- `coderabbit` is an optional review capability.

CodeRabbit does not initially get an audit/repair lifecycle unless the
architecture phase identifies a real drift surface beyond CLI/config
readiness. Its first-class ports are availability, preflight, optional
configuration, and review.

## Components

The new core lives under a clear capability area, for example:

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
- `core/capabilities/readiness/`: shared Git, GitHub, and Sonar readiness terms
  and helper checks reused by workspace capabilities and update-mode without
  sharing workspace orchestration. Git readiness is mandatory-flow readiness,
  not optional integration readiness.

Existing mixed modules are reduced to orchestration:

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
same Sonar enablement core as `workspace sonar enable`. If Sonar enablement
fails during workspace add, the workspace registration still succeeds when Git
and other required workspace preconditions are satisfied. The result records
Sonar as not configured, failed, or not meaningful with the reason and next
action. Sonar-owned partial writes must be either avoided up front or repaired
by rerunning Sonar enable/audit/repair; workspace registration is not rolled
back for optional Sonar failure.

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
- outcome from a closed set locked during architecture
- blocking flag
- summary
- artifact paths

The domain result remains tool-specific. Sonar keeps scanner, gate, condition,
scope, and coverage semantics. CodeRabbit keeps diff and finding semantics.
The common envelope is only for orchestration and presentation.

The architecture phase must lock the exact review envelope schema first,
because it becomes the contract between review capabilities, artifacts, CLI,
API, and UI compatibility.

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

The optional review outcome states are a closed set to be finalized in
architecture. The concept requires at least distinct states for ran, skipped,
failed, not configured, and not meaningful so UI, CLI, and artifacts do not
invent prose-only variants.

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

Exit codes distinguish usage errors, required capability failures, and
optional capability warnings. The architecture phase must assign exact codes
before implementation begins.

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
  behavior or minimal API/UI compatibility adjustments. Compatibility means
  existing endpoints, response field names, and documented OpenAPI shapes remain
  valid unless the architecture explicitly updates the API contract and the
  existing UI consumers in the same wave.

## Migration Strategy

The implementation is incremental rather than a single cutover.

Recommended order:

1. Introduce shared capability types, readiness helpers, and fake capability
   test doubles without changing public behavior.
2. Extract Git and GitHub context from workspace registration into explicit
   ports, keeping existing API and CLI outputs compatible.
3. Move Sonar enablement, config generation, audit, repair, and review adapter
   behavior into the Sonar capability.
4. Move CodeRabbit readiness and review behavior into the CodeRabbit capability.
5. Switch workspace registration/preflight to capability orchestration.
6. Switch review orchestration to review capabilities with the locked envelope.
7. Add dedicated CLI command groups and keep compatibility paths such as
   `workspace add --sonar` as thin delegations.
8. Align update-mode GitHub/Sonar readiness helpers without making update-mode
   a workspace-capability consumer.

Each step preserves existing behavior or includes the minimal API/UI
compatibility update needed for existing flows to keep working.

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
- Contract tests for the closed review envelope and optional review outcome
  states.
- Public CLI acceptance tests for `workspace sonar audit`, `repair`, and
  `repair --apply` with real file side effects.
- Tests proving `repair --apply` is idempotent for safe repairs and leaves
  risky repairs unapplied across repeated runs.
- Tests proving `workspace add --sonar` succeeds as a workspace registration
  when optional Sonar enablement fails, while recording the Sonar failure
  clearly.
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
