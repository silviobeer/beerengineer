import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { resolveConfiguredDbPath } from "../src/setup/config.js"
import { runSetupFlow, type SetupFlowDeps } from "../src/setup/setupFlow.js"
import type { SetupLaunchResult } from "../src/cli/ui.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-entry-"))
  return {
    dir,
    configPath: join(dir, "config", "config.json"),
    dataDir: join(dir, "data"),
    binDir: join(dir, "bin"),
  }
}

function makeStubBin(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
}

async function withCapturedConsole(fn: () => Promise<number>): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(" "))
  console.error = (...args: unknown[]) => lines.push(args.join(" "))
  try {
    const exitCode = await fn()
    return { exitCode, output: lines.join("\n") }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}

function installedGitWithoutIdentity(): string {
  return `
if [ "$1" = "--version" ]; then
  echo "git version 2.47.0"
  exit 0
fi
if [ "$1" = "config" ]; then
  exit 1
fi
exit 1`
}

function launchResult(overrides: Partial<SetupLaunchResult> = {}): SetupLaunchResult {
  return {
    engine: { status: "running", url: "http://127.0.0.1:4910" },
    ui: { status: "started", url: "http://192.0.2.10:5310" },
    setupUrl: "http://192.0.2.10:5310/setup",
    browser: { status: "opened" },
    ...overrides,
  }
}

test("interactive setup initializes config and opens the discovered setup URL", async () => {
  const paths = tempSetupPaths()
  const previousPath = process.env.PATH
  try {
    makeStubBin(paths.binDir, "git", installedGitWithoutIdentity())
    process.env.PATH = `${paths.binDir}:${previousPath ?? ""}`
    let launched = false
    const deps: SetupFlowDeps = {
      isInteractive: () => true,
      launchSetup: async () => {
        launched = true
        return launchResult()
      },
    }

    const result = await withCapturedConsole(() => runSetupFlow({
      group: "core",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, enginePort: 4910 },
      deps,
    }))

    assert.equal(result.exitCode, 0, result.output)
    assert.equal(launched, true)
    assert.equal(existsSync(paths.configPath), true)
    const config = JSON.parse(readFileSync(paths.configPath, "utf8")) as { dataDir: string }
    const db = initDatabase(resolveConfiguredDbPath(config))
    db.close()
    assert.match(result.output, /App setup initialized config, data dir, and database\./)
    assert.match(result.output, /Engine API: already running at http:\/\/127\.0\.0\.1:4910/)
    assert.match(result.output, /Setup UI: started at http:\/\/192\.0\.2\.10:5310/)
    assert.match(result.output, /Opened setup UI: http:\/\/192\.0\.2\.10:5310\/setup/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("interactive setup degrades browser failures to printing the discovered URL", async () => {
  const paths = tempSetupPaths()
  const previousPath = process.env.PATH
  try {
    makeStubBin(paths.binDir, "git", installedGitWithoutIdentity())
    process.env.PATH = `${paths.binDir}:${previousPath ?? ""}`
    const deps: SetupFlowDeps = {
      isInteractive: () => true,
      launchSetup: async () => launchResult({
        engine: { status: "started", url: "http://127.0.0.1:4920" },
        ui: { status: "started", url: "http://192.0.2.20:5320" },
        setupUrl: "http://192.0.2.20:5320/setup",
        browser: { status: "printed", detail: "CI environment detected." },
      }),
      createQuestioner: () => ({
        question: async () => "n",
        close: () => {},
      }),
    }

    const result = await withCapturedConsole(() => runSetupFlow({
      group: "core",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, enginePort: 4920 },
      deps,
    }))

    assert.equal(result.exitCode, 0, result.output)
    assert.match(result.output, /Engine API: started at http:\/\/127\.0\.0\.1:4920/)
    assert.match(result.output, /Setup UI: started at http:\/\/192\.0\.2\.20:5320/)
    assert.match(result.output, /Setup UI URL: http:\/\/192\.0\.2\.20:5320\/setup/)
    assert.match(result.output, /hint: CI environment detected\./)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("setup --no-interactive neither launches UI nor prompts for Git identity", async () => {
  const paths = tempSetupPaths()
  const previousPath = process.env.PATH
  const previousApiKey = process.env.ANTHROPIC_API_KEY
  try {
    makeStubBin(paths.binDir, "git", installedGitWithoutIdentity())
    makeStubBin(paths.binDir, "claude", "echo 'claude 1.2.3'")
    process.env.PATH = `${paths.binDir}:${previousPath ?? ""}`
    process.env.ANTHROPIC_API_KEY = "test-key"
    let launched = false
    let prompted = false

    const result = await withCapturedConsole(() => runSetupFlow({
      noInteractive: true,
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
      deps: {
        isInteractive: () => true,
        launchSetup: async () => {
          launched = true
          return launchResult()
        },
        createQuestioner: () => ({
          question: async () => {
            prompted = true
            return ""
          },
          close: () => {},
        }),
      },
    }))

    assert.equal(result.exitCode, 0, result.output)
    assert.equal(launched, false)
    assert.equal(prompted, false)
    assert.match(result.output, /Git identity is missing; workflows will be blocked/)
    assert.doesNotMatch(result.output, /Opened setup UI/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousApiKey
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("setup --group supabase prints manual project guidance without requiring browsing", async () => {
  const paths = tempSetupPaths()
  try {
    const result = await withCapturedConsole(() => runSetupFlow({
      group: "supabase",
      noInteractive: true,
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    }))

    assert.equal(result.exitCode, 0, result.output)
    assert.match(result.output, /Create or select the Supabase Cloud project manually/)
    assert.match(result.output, /region\/location/)
    assert.match(result.output, /provider-side project settings/)
    assert.match(result.output, /branching support/)
    assert.match(result.output, /project ref/)
    assert.match(result.output, /Management API token/)
    assert.match(result.output, /https:\/\/supabase\.com\/dashboard/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
