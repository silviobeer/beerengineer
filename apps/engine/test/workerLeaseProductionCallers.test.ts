import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function source(path: string): string {
  return readFileSync(resolve(path), "utf8")
}

test("worker lease primitives have production callers in start and resume paths", () => {
  const orchestrator = source("src/core/runOrchestrator.ts")
  const runService = source("src/core/runService.ts")
  const resume = source("src/core/resume.ts")
  const cliActions = source("src/cli/commands/itemActions.ts")

  assert.match(orchestrator, /claimWorkerLease\(/, "prepareRun must claim leases for CLI/API starts")
  assert.match(orchestrator, /startWorkerLeaseHeartbeat\(/, "prepareRun must start heartbeat lifecycle for starts")
  assert.match(resume, /claimWorkerLease\(/, "performResume must reclaim the same run row before side effects")
  assert.match(resume, /startWorkerLeaseHeartbeat\(/, "performResume must heartbeat resumed work")
  assert.match(runService, /apiWorkerInstanceId/, "API start/resume must thread the API engine instance id")
  assert.match(cliActions, /workerOwnerKind:\s*"cli"/, "CLI resume must request CLI worker ownership")
})
