import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveHarness } from "../src/llm/registry.js"
import { defaultWorkspaceRuntimePolicy } from "../src/core/workspaces.js"

function expectHosted(resolved: ReturnType<typeof resolveHarness>) {
  if (resolved.kind !== "hosted") {
    throw new Error(`expected hosted harness, got ${resolved.kind}`)
  }
  return resolved
}

test("resolveHarness maps fast mode coder to codex with the fast tier model (per preset)", () => {
  const resolved = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "fast" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "planning",
    }),
  )

  assert.equal(resolved.harness, "codex")
  assert.equal(resolved.provider, "openai")
  assert.equal(resolved.runtime, "cli")
  assert.equal(resolved.model, "gpt-4o")
})

test("resolveHarness maps fast mode reviewer to claude haiku (per preset)", () => {
  const resolved = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "fast" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "planning",
    }),
  )

  assert.equal(resolved.harness, "claude")
  assert.equal(resolved.provider, "anthropic")
  assert.equal(resolved.runtime, "cli")
  assert.equal(resolved.model, "claude-haiku-4-5")
})

test("resolveHarness claude-first splits coder=claude and reviewer=codex per preset", () => {
  const coder = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "claude-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "brainstorm",
    }),
  )
  const reviewer = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "claude-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "brainstorm",
    }),
  )

  assert.equal(coder.harness, "claude")
  assert.equal(coder.runtime, "cli")
  assert.equal(coder.model, "claude-sonnet-4-6")
  assert.equal(reviewer.harness, "codex")
  assert.equal(reviewer.runtime, "cli")
  assert.equal(reviewer.model, "gpt-5.4")
})

test("resolveHarness codex-first splits coder=codex and reviewer=claude per preset", () => {
  const coder = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "codex-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "planning",
    }),
  )
  const reviewer = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "codex-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "planning",
    }),
  )

  assert.equal(coder.harness, "codex")
  assert.equal(reviewer.harness, "claude")
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
  const resolved = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "claude-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "execution",
    }),
  )
  assert.equal(resolved.harness, "claude")
  assert.equal(resolved.model, "claude-opus-4-7")
})

test("resolveHarness honours the runtime field on claude-sdk-first preset (coder is sdk, reviewer stays cli)", () => {
  const coder = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "claude-sdk-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "execution",
    }),
  )
  const reviewer = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "claude-sdk-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "planning",
    }),
  )
  assert.equal(coder.harness, "claude")
  assert.equal(coder.runtime, "sdk")
  assert.equal(reviewer.harness, "codex")
  assert.equal(reviewer.runtime, "cli")
})

test("self-mode supports per-role runtime mixing including merge-resolver", () => {
  const reviewer = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: { harness: "claude", provider: "anthropic", model: "claude-opus-4-7", runtime: "sdk" },
          reviewer: { harness: "codex", provider: "openai", model: "gpt-5.4", runtime: "cli" },
          "merge-resolver": { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "cli" },
        },
      },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "planning",
    }),
  )
  const mergeResolver = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: { harness: "claude", provider: "anthropic", model: "claude-opus-4-7", runtime: "sdk" },
          reviewer: { harness: "codex", provider: "openai", model: "gpt-5.4", runtime: "cli" },
          "merge-resolver": { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "cli" },
        },
      },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "merge-resolver",
      stage: "execution",
    }),
  )

  assert.equal(reviewer.runtime, "cli")
  assert.equal(reviewer.harness, "codex")
  assert.equal(mergeResolver.runtime, "cli")
  assert.equal(mergeResolver.harness, "claude")
  assert.equal(mergeResolver.model, "claude-sonnet-4-6")
})

test("resolveHarness honours the runtime field on codex-sdk-first preset (coder is sdk, reviewer stays cli)", () => {
  const coder = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "codex-sdk-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "execution",
    }),
  )
  const reviewer = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: { mode: "codex-sdk-first" },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "reviewer",
      stage: "planning",
    }),
  )
  assert.equal(coder.harness, "codex")
  assert.equal(coder.runtime, "sdk")
  assert.equal(reviewer.harness, "claude")
  assert.equal(reviewer.runtime, "cli")
})

test("legacy self-mode roles without a runtime field default to cli", () => {
  const coder = expectHosted(
    resolveHarness({
      workspaceRoot: "/tmp/demo",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6" },
          reviewer: { harness: "codex", provider: "openai", model: "gpt-5.4" },
        },
      },
      runtimePolicy: defaultWorkspaceRuntimePolicy(),
      role: "coder",
      stage: "planning",
    }),
  )
  assert.equal(coder.runtime, "cli")
})
