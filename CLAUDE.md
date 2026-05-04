# CLAUDE.md

**Must read before doing anything in this repo:** [`AGENTS.md`](./AGENTS.md).

It covers the repo layout, where each topic lives, the commands, the
commit-message rule the pre-commit hook enforces, and the authority
order when docs and code disagree. Two minutes of reading saves an
hour of guessing.

## Engineering rules

<!-- CLAUDE-PROJ4-QA-004 --> Engine modules with no production caller outside their own tests are not features — block PRDs that ship test-only code.
<!-- CLAUDE-PROJ4-QA-005 --> Always derive filesystem paths from server-side state; never trust path/ID fields from request bodies.
<!-- CLAUDE-PROJ4-QA-006 --> Destructive-SQL detection requires Postgres-accurate string lexing (dollar-quoted strings, `standard_conforming_strings` semantics).
<!-- CLAUDE-PROJ4-QA-007 --> Privileged secret refs (e.g. Supabase mgmt token) must be deny-listed from the generic `/setup/secrets/<ref>` handler.
<!-- CLAUDE-PROJ4-QA-008 --> Cross-check `projectRef`/`branchRef` against the run/workspace row before adapter operations; the management token is shared, the routes are not.
<!-- CLAUDE-PROJ4-QA-010 --> Settings sections must render a "not configured" stub, not their full control set, when the underlying capability is absent.
<!-- CLAUDE-PROJ4-QA-011 --> Never publish two functions with the same exported name and different signatures across two paths — pick the layer.
