import { test } from "node:test"
import assert from "node:assert/strict"

import {
  MANAGED_INSTALL_RESULT_VERSION,
  REQUIRED_MANAGED_INSTALL_PHASES,
  buildManagedInstallSummary,
  createManagedInstallErrorResult,
  createManagedInstallPhase,
  createManagedInstallResult,
  renderManagedInstallHuman,
  renderManagedInstallJson,
} from "../src/core/managedInstall/diagnostics.js"

test("createManagedInstallResult provides schema version operation id and JSON-safe errors", () => {
  const result = createManagedInstallErrorResult({
    operationId: "op-123",
    error: new Error("release required"),
  })

  assert.equal(result.version, MANAGED_INSTALL_RESULT_VERSION)
  assert.equal(result.operationId, "op-123")
  assert.equal(result.exitCode, 1)
  assert.match(renderManagedInstallJson(result), /"operationId": "op-123"/)
  assert.doesNotThrow(() => JSON.parse(renderManagedInstallJson(result)))
})

test("phase model contains required phases with shared status vocabulary", () => {
  const phases = REQUIRED_MANAGED_INSTALL_PHASES.map(name => createManagedInstallPhase({
    name,
    status: name === "uiStart" ? "warning" : "ok",
    message: `${name} done`,
    fixHint: name === "uiStart" ? "Run npm run dev:ui." : undefined,
    durationMs: 5,
  }))
  const result = createManagedInstallResult({
    operationId: "op-phases",
    phases,
    summary: buildManagedInstallSummary({ phases }),
  })
  const rendered = renderManagedInstallHuman(result)

  assert.deepEqual(phases.map(phase => phase.name), ["prerequisites", "download", "install", "setup", "engineStart", "uiStart"])
  for (const phase of phases) {
    assert.match(rendered, new RegExp(`${phase.name}\\s+${phase.status.toUpperCase()}`))
  }
  assert.deepEqual(
    JSON.parse(renderManagedInstallJson(result)).phases.map((phase: { name: string; status: string }) => [phase.name, phase.status]),
    phases.map(phase => [phase.name, phase.status]),
  )
})

test("summary carries target metadata commands exit code and warning semantics", () => {
  const phases = [
    createManagedInstallPhase({ name: "prerequisites", status: "ok", message: "ok", durationMs: 1 }),
    createManagedInstallPhase({ name: "download", status: "ok", message: "ok", durationMs: 1 }),
    createManagedInstallPhase({ name: "install", status: "ok", message: "ok", durationMs: 1 }),
    createManagedInstallPhase({ name: "setup", status: "ok", message: "ok", durationMs: 1 }),
    createManagedInstallPhase({ name: "engineStart", status: "ok", message: "ok", durationMs: 1 }),
    createManagedInstallPhase({ name: "uiStart", status: "warning", message: "manual UI start required", durationMs: 1 }),
  ]
  const target = {
    repo: "silviobeer/beerengineer",
    tag: "v1.0.0",
    version: "1.0.0",
    tarballUrl: "https://api.github.com/repos/silviobeer/beerengineer/tarball/v1.0.0",
    htmlUrl: "https://github.com/silviobeer/beerengineer/releases/tag/v1.0.0",
    publishedAt: "2026-01-01T00:00:00Z",
    download: {
      tarballUrl: "https://api.github.com/repos/silviobeer/beerengineer/tarball/v1.0.0",
      host: "api.github.com",
      protocol: "https:",
    },
  }
  const summary = buildManagedInstallSummary({
    phases,
    wrapperPath: "/home/user/.local/share/beerengineer-nodejs/bin/beerengineer",
    engineUrl: "http://127.0.0.1:4100",
    uiUrl: "http://127.0.0.1:3000",
    nextCommands: ["beerengineer start", "npm run dev:ui"],
    pathInstructions: ["Add /home/user/.local/share/beerengineer-nodejs/bin to PATH."],
  })
  const result = createManagedInstallResult({ operationId: "op-summary", phases, target, summary })
  const rendered = renderManagedInstallHuman(result)

  assert.equal(result.summary.status, "succeeded-with-warning")
  assert.equal(result.exitCode, 0)
  assert.equal(result.target?.repo, "silviobeer/beerengineer")
  assert.equal(result.summary.wrapperPath, "/home/user/.local/share/beerengineer-nodejs/bin/beerengineer")
  assert.deepEqual(result.summary.pathInstructions, ["Add /home/user/.local/share/beerengineer-nodejs/bin to PATH."])
  assert.deepEqual(result.summary.nextCommands, ["beerengineer start", "npm run dev:ui"])
  assert.deepEqual(result.summary.warnings, ["uiStart: manual UI start required"])
  assert.match(rendered, /path: Add \/home\/user\/\.local\/share\/beerengineer-nodejs\/bin to PATH\./)
})
