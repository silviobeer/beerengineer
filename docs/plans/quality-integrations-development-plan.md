# Quality Integrations Development Plan

## Goal

Add SonarCloud and Coderabbit as first-class quality integrations at the CLI and workflow layer now, so a later UI setup flow can plug into the same backend without redesign.

The system should not treat review and verification as pass/fail events only. Every review and verification step should also produce reusable project knowledge that improves the next implementation.

## Principles

- `.env` is bootstrap-only, not the long-term source of truth.
- Workspace-scoped settings should drive behavior.
- Sonar and Coderabbit setup should follow the same integration model.
- Sonar and Coderabbit should feed implementation-quality review early, not wait until QA.
- Wave-level quality handling should aggregate and summarize, not replace story-level review.
- QA should confirm quality status and add system-level findings, not be the first place quality issues are discovered.
- Every quality step should produce both:
  - a decision output
  - a knowledge output

## Quality Model

Each quality step should emit two outputs.

1. Decision output

   Examples:
   - `passed`
   - `review_required`
   - `failed`
   - `blocked`

2. Knowledge output

   Examples:
   - recurring issue patterns
   - architectural constraints
   - fragile modules
   - preferred implementation styles
   - remediation lessons
   - verification gaps
   - integration risks

This knowledge should be stored and reused during future implementation, review, remediation, wave planning, and QA.

## What The System Should Learn

### From SonarCloud

- recurring duplication areas
- fragile modules
- coverage gaps
- security hotspot patterns
- rules repeatedly violated by this repo or team

### From Coderabbit

- recurring design and review feedback
- preferred coding patterns
- architectural boundaries being crossed
- anti-patterns repeated across stories
- reviewer expectations that can be turned into guardrails

### From Verification And QA

- flaky workflows
- integration pain points
- missing test scaffolds
- assumptions that repeatedly fail
- risky dependency paths between stories or modules

## How That Knowledge Should Be Used

Feed it back into:

- execution context for the next story
- remediation prompts
- review prompts
- wave planning and risk summaries
- project coding guidelines
- workspace-level engineering constraints

Every quality command should end with:

- result
- findings
- lessons learned
- future guardrails

## Phase 1: Domain And Storage

1. Add dedicated workspace-scoped integration config models.

   At minimum:
   - SonarCloud config
   - Coderabbit config

2. Use the same setup model for both integrations.

   Common fields:
   - `enabled`
   - `providerType`
   - `hostUrl`
   - `organization` or equivalent owner/account field
   - `projectKey` or repository identifier
   - `tokenRef` or encrypted token field
   - `defaultBranch`
   - `gatingMode`
   - `createdAt`
   - `updatedAt`

3. Decide storage split.

   Recommended:
   - non-secret config in DB
   - token stored separately or encrypted at rest
   - temporary fallback to `.env.local` only when DB config is absent

4. Make config workspace-scoped.

   A workspace should be able to point to its own SonarCloud project and Coderabbit target repository.

5. Add migrations and repository methods.

   Needed methods:
   - `getByWorkspaceId`
   - `upsertByWorkspaceId`
   - `clearToken`
   - `isConfigured`

## Phase 2: Knowledge Layer

1. Add a persistent quality knowledge store.

   Examples:
   - `project_memory_entries`
   - `quality_learning_entries`
   - `review_knowledge_entries`

2. Each record should capture:
   - source
     - `sonar`
     - `coderabbit`
     - `verification`
     - `qa`
     - `story_review`
   - scope
     - workspace
     - project
     - wave
     - story
     - file
     - module
   - kind
     - `rule`
     - `constraint`
     - `lesson`
     - `recurring_issue`
     - `recommendation`
   - summary
   - evidence
   - resolution or status
   - relevance tags
     - files
     - story codes
     - modules
     - categories

3. Add retrieval methods for future prompts.

   Needed use cases:
   - lessons relevant to a story’s touched files
   - recurring findings for a project
   - unresolved risks for a wave
   - recently learned architectural constraints
   - quality-to-QA context projection so QA gets a precomputed risk summary instead of raw findings dumps

## Phase 3: Service Layer

1. Add a `SonarService`.

   Responsibilities:
   - resolve effective Sonar config
   - run scanner CLI
   - poll MCP for quality gate, issues, and hotspots
   - normalize results into app-native DTOs
   - extract knowledge entries from findings

2. Add a `CoderabbitService`.

   Responsibilities:
   - resolve effective Coderabbit config
   - run review commands
   - collect review findings
   - normalize results into app-native DTOs
   - extract knowledge entries from findings

3. Keep service boundaries clean.

   Split into:
   - config resolution
   - tool execution
   - result fetching
   - gating decisions
   - knowledge extraction

4. Define stable output contracts now.

   For example:
   - `SonarConfigView`
   - `SonarScanResult`
   - `SonarGateStatus`
   - `SonarIssueSummary`
   - `SonarHotspotSummary`
   - `CoderabbitConfigView`
   - `CoderabbitReviewResult`
   - `CoderabbitFindingSummary`
   - `QualityKnowledgeEntry`

These contracts should be UI-ready so the future setup screen and status panels reuse them directly.

## Phase 4: CLI Commands

1. Add Sonar config commands.

   - `beerengineer sonar config show`
   - `beerengineer sonar config set`
   - `beerengineer sonar config test`
   - `beerengineer sonar config clear-token`

2. Add Sonar operational commands.

   - `beerengineer sonar scan`
   - `beerengineer sonar status`
   - `beerengineer sonar issues`
   - `beerengineer sonar hotspots`

3. Add Coderabbit config commands.

   Setup should mirror Sonar:
   - `beerengineer coderabbit config show`
   - `beerengineer coderabbit config set`
   - `beerengineer coderabbit config test`
   - `beerengineer coderabbit config clear-token`
   - `beerengineer coderabbit context`
   - `beerengineer coderabbit preflight`

4. Add Coderabbit operational commands.

   - `beerengineer coderabbit review --live`
   - `beerengineer review run --story <id>`
   - `beerengineer review status --story <id>`
   - `beerengineer review remediate --story-review-run <id>`

5. Add machine-readable output.

   Every command should support JSON output so the UI can later call the same backend logic or mirror its shape.

6. Support safe bootstrap.

   If DB config is missing:
   - read `.env.local`
   - warn that it is fallback-only
   - offer a command to persist settings into workspace config

## Phase 5: Workflow Integration

### Story / Branch Level

This is the primary implementation-quality gate.

Recommended default flow:

1. execution
2. verification
3. Sonar branch or pull-request analysis
4. Coderabbit review
5. remediation if needed
6. Sonar branch or pull-request re-check after remediation
7. Coderabbit re-review after remediation
8. mark complete

Story and branch level are the best place for:

- attributable findings
- small, understandable diffs
- reusable implementation lessons
- tight remediation loops

Implementation status update:

- Sonar now follows this branch-/PR-aware model with explicit live-vs-fallback handling.
- CodeRabbit now mirrors that direction:
  - CLI-auth detection via `cr auth status --agent`
  - repository fallback via `git remote origin`
  - branch-/PR-aware `beerengineer coderabbit context`
  - explicit `beerengineer coderabbit review --live`
  - fallback to persisted `qualityKnowledge` when live review is unavailable

### Wave Level

Wave level should not be a separate local verification phase.

Instead, it should be:

- a verification summary
- a quality gate summary
- a cross-story risk summary

Recommended wave outputs:

- aggregate Sonar status for stories in the wave
- unresolved Coderabbit findings across the wave
- repeated issues seen across multiple stories
- duplication drift and coverage drift
- lessons to carry into the next wave

If needed later, add an optional lightweight `wave integration check`, but do not confuse it with story-level local verification.

### QA Level

QA should:

- confirm the project is already in a healthy quality state
- add system-level and integration-level lessons
- not be the first place Sonar or Coderabbit runs

### Phase 5B: QA Integration

QA must explicitly consume prior quality knowledge before execution.

QA runs should receive:

- story- and branch-scoped Sonar summaries
- Coderabbit findings and remediation history
- wave-level repeated issue summaries
- fragile modules and files
- unresolved risks and explicit waivers

QA should use that context to:

- prioritize high-risk validation areas first
- focus on cross-story integration seams
- validate recently remediated stories more aggressively
- check whether repeated review findings correlate with real runtime issues

QA must also write back structured knowledge:

- integration failures
- flaky flows
- broken assumptions
- missing test coverage at workflow boundaries
- future implementation guardrails

QA output should feed the same persistent knowledge store as Sonar and Coderabbit, so QA becomes both:

- a downstream consumer of code-quality knowledge
- an upstream producer of implementation guidance for the next cycle

### Gating Modes

Suggested modes:

- `off`
- `advisory`
- `story_gate`
- `wave_gate`

## Phase 6: UI-Ready Design Decisions

1. Make config APIs idempotent.

   UI setup wizard will need:
   - load current config
   - save partial config
   - test connection
   - replace token without re-entering everything

2. Separate "configured" from "valid".

   The UI will need to show:
   - not configured
   - configured but untested
   - valid
   - invalid token/project/repository

3. Preserve token secrecy in responses.

   Never return raw tokens from service or CLI responses.

4. Keep host, organization, project, and repository identifiers editable independently.

   The future UI wizard will need stepwise validation.

5. Keep UI as a client of the same backend.

   The UI should call the same service logic and consume the same DTOs the CLI uses, not create a second implementation path.

## Phase 7: Suggested Data Model

### Integration Config

Option A: dedicated tables

- `workspace_sonar_settings`
- `workspace_coderabbit_settings`

Shared fields:

- `workspace_id`
- `enabled`
- `host_url`
- `organization`
- `project_key` or repo identifier
- `default_branch`
- `gating_mode`
- `token_encrypted` or `token_ref`
- timestamps

Option B: generic table

- `workspace_integrations`
  - `workspace_id`
  - `integration_type`
  - `config_json`
  - `token_ref`
  - timestamps

If Sonar and Coderabbit are the only integrations for now, dedicated tables are simpler. If more tooling will follow, a generic integration table is more extensible.

### Knowledge Store

Recommended table:

- `quality_knowledge_entries`

Suggested fields:

- `id`
- `workspace_id`
- `project_id`
- `wave_id`
- `story_id`
- `source`
- `scope_type`
- `scope_id`
- `kind`
- `summary`
- `evidence_json`
- `status`
- `relevance_tags_json`
- `created_at`
- `updated_at`

## Phase 8: Verification

1. Unit tests for config resolution.

   Cover:
   - DB config
   - `.env` fallback
   - missing token
   - invalid host/project/repository settings

2. Unit tests for knowledge extraction.

   Cover:
   - Sonar issue to knowledge entry mapping
   - Coderabbit finding to knowledge entry mapping
   - deduplication of recurring lessons

3. Integration tests for CLI commands.

   Cover:
   - config set/show
   - connection testing
   - scan/review invocation
   - MCP result fetch
   - gating outcomes

4. Workflow tests.

   Cover:
   - story blocked by Sonar or Coderabbit in gate mode
   - advisory mode only warns
   - remediation reruns review tools
   - wave summary includes quality rollups
   - future story context includes prior lessons

## Recommended Implementation Order

1. DB schema and repositories for Sonar, Coderabbit, and quality knowledge
2. `SonarService`
3. `CoderabbitService`
4. knowledge extraction and retrieval layer
5. CLI config commands for both integrations
6. CLI scan/review commands
7. story-level workflow gating and knowledge capture
8. wave-level quality summary and learning aggregation
9. UI setup on top of existing service contracts

## Important Non-Goals For First Pass

- full UI now
- multi-provider static analysis abstraction beyond Sonar and Coderabbit
- PR decoration support
- cross-workspace admin screens
- full autonomous learning system beyond explicit structured memory capture

## Outcome

If implemented this way, the later UI work becomes mostly:

- a Sonar setup form
- a Coderabbit setup form
- test-connection buttons
- quality status panels
- gating-mode selectors
- a review and lessons timeline

The backend and CLI behavior will already exist, so the UI is just another client, not a second implementation.
