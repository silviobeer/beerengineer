import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveNpmCommandForPlatform, resolveSwitcherScriptExtension } from "../src/core/updateMode.js"

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
