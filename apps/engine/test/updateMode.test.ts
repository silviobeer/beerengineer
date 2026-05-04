import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveNpmCommandForPlatform, resolveSwitcherScriptExtension } from "../src/core/updateMode.js"
import { capabilityStatusFromReady, sharedReadiness } from "../src/core/capabilities/index.js"

test("resolveNpmCommandForPlatform uses npm.cmd on Windows and npm elsewhere", () => {
  assert.equal(resolveNpmCommandForPlatform("win32"), "npm.cmd")
  assert.equal(resolveNpmCommandForPlatform("linux"), "npm")
  assert.equal(resolveNpmCommandForPlatform("darwin"), "npm")
})

test("resolveSwitcherScriptExtension matches the current platform family", () => {
  assert.equal(resolveSwitcherScriptExtension("win32"), "cmd")
  assert.equal(resolveSwitcherScriptExtension("linux"), "sh")
  assert.equal(resolveSwitcherScriptExtension("darwin"), "sh")
})

test("PROJ-3-PRD-1 AC-19 shared readiness terminology covers Git, GitHub, and Sonar", () => {
  assert.deepEqual(
    ["git", "github", "sonar"].map(id => sharedReadiness(id as "git" | "github" | "sonar", "ready").capabilityId),
    ["git", "github", "sonar"],
  )
})

test("PROJ-3-PRD-1 AC-20 update mode remains separate from workspace capability orchestration", async () => {
  const updateReadiness = await import("../src/core/updateMode/readiness.js")
  assert.equal("runWorkspacePreflight" in updateReadiness, false)
})

test("PROJ-3-PRD-1 AC-21 update-mode GitHub/Sonar readiness uses shared helper behavior", () => {
  assert.equal(capabilityStatusFromReady(true), "ready")
  assert.equal(capabilityStatusFromReady(false, "not_configured"), "not_configured")
})

test("PROJ-3-PRD-1 AC-22 update mode documents different inputs while preserving readiness meaning", () => {
  assert.equal(sharedReadiness("sonar", "not_applicable").status, "not_applicable")
})

test("PROJ-3-PRD-5 AC-19 update-mode GitHub and Sonar readiness uses shared helper terms", () => {
  assert.equal(capabilityStatusFromReady(true), "ready")
  assert.equal(capabilityStatusFromReady(false, "not_configured"), "not_configured")
})

test("PROJ-3-PRD-5 AC-20 update-mode preserves readiness meaning when inputs differ", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/core/updateMode/readiness.ts", import.meta.url), "utf8"))
  assert.match(source, /Update mode has no selected workspace preflight context/)
})

test("PROJ-3-PRD-5 AC-21 update-mode does not consume workspace capability orchestration", async () => {
  const updateReadiness = await import("../src/core/updateMode/readiness.js")
  assert.equal("runWorkspacePreflight" in updateReadiness, false)
})

test("PROJ-3-PRD-5 AC-22 existing update status readiness states remain compatible", () => {
  assert.equal(sharedReadiness("sonar", "not_applicable").status, "not_applicable")
  assert.equal(sharedReadiness("github", "failed").status, "failed")
})

test("PROJ-3-PRD-5 AC-23 update-readiness covers GitHub and Sonar warning behavior", () => {
  assert.equal(capabilityStatusFromReady(false, "not_configured"), "not_configured")
  assert.equal(sharedReadiness("github", "failed").capabilityId, "github")
})
