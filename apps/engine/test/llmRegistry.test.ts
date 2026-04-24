import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveHarness } from "../src/llm/registry.js"
import { defaultWorkspaceRuntimePolicy } from "../src/core/workspaces.js"

test("resolveHarness maps fast mode coder to codex with the fast tier model (per preset)", () => {
  const resolved = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "fast" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "coder",
    stage: "planning",
  })

  assert.equal(resolved.provider, "codex")
  assert.equal(resolved.model, "gpt-4o")
})

test("resolveHarness maps fast mode reviewer to claude-code haiku (per preset)", () => {
  const resolved = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "fast" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "reviewer",
    stage: "planning",
  })

  assert.equal(resolved.provider, "claude-code")
  assert.equal(resolved.model, "claude-haiku-4-5")
})

test("resolveHarness claude-first splits coder=claude and reviewer=codex per preset", () => {
  const coder = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "claude-first" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "coder",
    stage: "brainstorm",
  })
  const reviewer = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "claude-first" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "reviewer",
    stage: "brainstorm",
  })

  assert.equal(coder.provider, "claude-code")
  assert.equal(coder.model, "claude-sonnet-4-6")
  assert.equal(reviewer.provider, "codex")
  assert.equal(reviewer.model, "gpt-5.4")
})

test("resolveHarness codex-first splits coder=codex and reviewer=claude per preset", () => {
  const coder = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "codex-first" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "coder",
    stage: "planning",
  })
  const reviewer = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "codex-first" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "reviewer",
    stage: "planning",
  })

  assert.equal(coder.provider, "codex")
  assert.equal(reviewer.provider, "claude-code")
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

test("resolveHarness upgrades coder to opus for execution stage on claude-first (implementation needs the strongest model)", () => {
  const resolved = resolveHarness({
    workspaceRoot: "/tmp/demo",
    harnessProfile: { mode: "claude-first" },
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
    role: "coder",
    stage: "execution",
  })
  assert.equal(resolved.provider, "claude-code")
  assert.equal(resolved.model, "claude-opus-4-7")
})
