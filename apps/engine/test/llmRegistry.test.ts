import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveHarness } from "../src/llm/registry.js"
import { defaultWorkspaceRuntimePolicy } from "../src/core/workspaces.js"

test("resolveHarness maps fast mode to claude-code with the fast tier model", () => {
  const resolved = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "fast" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "coder",
    stage: "planning",
  })

  assert.equal(resolved.provider, "claude-code")
  assert.equal(resolved.model, "claude-haiku-4-5")
})

test("resolveHarness rejects opencode until the provider is implemented", () => {
  assert.throws(
    () =>
      resolveHarness({
        workspaceRoot: "/tmp/demo",
        harnessProfile: {
          mode: "self",
          roles: {
            coder: { harness: "opencode", provider: "openrouter", model: "x" },
            reviewer: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6" },
          },
        },
        runtimePolicy: defaultWorkspaceRuntimePolicy(),
        role: "coder",
        stage: "planning",
      }),
    /opencode/,
  )
})
