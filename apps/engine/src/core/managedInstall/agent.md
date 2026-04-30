# Agent Notes — Managed Install

## Gotchas

### Engine npm test script does not target files
Discovered during Wave 1. `npm test --workspace=@beerengineer/engine -- managedInstallRelease.test.ts`
still runs the package script's hardcoded `test/*.test.ts` glob before the extra file argument.
Use direct commands for focused managed-install checks:
`node --test --import tsx apps/engine/test/managedInstallRelease.test.ts`.

### Current dirty preview-host work can fail unrelated integration tests
The pre-existing preview/public-base-url changes in this worktree make
`apiIntegration.test.ts` emit a Tailscale/LAN preview URL where the existing
test expected loopback. Keep Wave 1 gates focused on managed-install ACs until
that separate preview-host work is reconciled.

## Patterns That Work Well

- Keep managed first-install contracts in `apps/engine/src/core/managedInstall/`
  and reuse small update-mode helpers like release tag normalization without
  coupling first-install behavior to update command state.
