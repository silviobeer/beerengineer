# BeerEngineer2

A multi-stage LLM workflow engine with a live Next.js UI. Projects move from free-form idea → PRD → architecture → plan → executed code → review → docs through discrete, resumable stages backed by hosted CLI providers (Claude Code, Codex, OpenCode).

## Quick start

```bash
npm install
npm run start:api      # engine HTTP + SSE on :4100
npm run dev:ui         # Next.js UI on :3100
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor
npm exec --workspace=@beerengineer2/engine beerengineer -- setup --no-interactive
```

## Key concepts

- **Stages** run as coder + reviewer pairs with session resume and review-cycle budgets
- **Real git branching** from `item/` → `proj/` → `wave/` → `story/` with `--no-ff` merges
- **Parallel review gate** per story: CodeRabbit + SonarCloud (when configured); fix-cycles until critical/high clears
- **Retry-on-transient** for hosted CLI: exit 143/137, empty output, network errors (2s + 8s backoff)
- **Codex live streaming** of turn/tool events; Claude streaming spec'd, not yet implemented

## Docs

- `docs/features-doc.md` — feature set
- `docs/technical-doc.md` — architecture + runtime topology
- `docs/known-issues.md` — current limitations
- `specs/` — active and pending feature specs

## Test

```bash
npm test --workspace=@beerengineer2/engine
npm test --workspace=@beerengineer2/ui
```
