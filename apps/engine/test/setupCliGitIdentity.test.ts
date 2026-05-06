import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { defaultAppConfig, readConfigFile, writeConfigFile } from "../src/setup/config.js"
import { readGlobalGitReadiness } from "../src/setup/gitIdentity.js"
import { maybeConfigureGitIdentityInteractive, type SetupQuestioner } from "../src/setup/setupFlow.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-git-cli-"))
  return {
    dir,
    configPath: join(dir, "config", "config.json"),
    dataDir: join(dir, "data"),
    binDir: join(dir, "bin"),
    gitLogPath: join(dir, "git.log"),
  }
}

function makeStubBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
  return path
}

function fakeQuestioner(answers: string[], prompts: string[] = []): SetupQuestioner {
  return {
    question: async (prompt: string) => {
      prompts.push(prompt)
      return answers.shift() ?? ""
    },
    close: () => {},
  }
}

async function withCapturedConsole(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => lines.push(args.join(" "))
  try {
    await fn()
    return lines.join("\n")
  } finally {
    console.log = originalLog
  }
}

test("interactive CLI setup saves an app-level Git identity with shared validation", async () => {
  const paths = tempSetupPaths()
  try {
    const gitBin = makeStubBin(paths.binDir, "git", `
if [ "$1" = "--version" ]; then
  echo "git version 2.47.0"
  exit 0
fi
exit 1`)
    const config = { ...defaultAppConfig(), dataDir: paths.dataDir }
    writeConfigFile(paths.configPath, config)

    await maybeConfigureGitIdentityInteractive(paths.configPath, config, {
      createQuestioner: () => fakeQuestioner(["", "CLI Person", "cli@local.beerengineer"]),
    })

    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    assert.deepEqual(state.kind === "ok" ? state.config.gitIdentityDefault : undefined, {
      displayName: "CLI Person",
      email: "cli@local.beerengineer",
      localOnly: true,
    })
    const readiness = readGlobalGitReadiness(state.kind === "ok" ? state.config : config, { gitBin })
    assert.equal(readiness.appDefaultIdentity?.displayName, "CLI Person")
    assert.equal(readiness.effectiveIdentity?.source, "app-default")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("interactive CLI setup prints field-specific validation errors", async () => {
  const paths = tempSetupPaths()
  try {
    const gitBin = makeStubBin(paths.binDir, "git", `
if [ "$1" = "--version" ]; then
  echo "git version 2.47.0"
  exit 0
fi
exit 1`)
    const config = { ...defaultAppConfig(), dataDir: paths.dataDir }
    writeConfigFile(paths.configPath, config)

    const output = await withCapturedConsole(() => maybeConfigureGitIdentityInteractive(paths.configPath, config, {
      gitCommandOptions: { gitBin },
      createQuestioner: () => fakeQuestioner(["", "", "bad-email", "n"]),
    }))

    assert.match(output, /displayName: Display name is required\./)
    assert.match(output, /email: Email must look like name@example.com\./)
    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    assert.equal(state.kind === "ok" ? state.config.gitIdentityDefault : undefined, undefined)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("interactive CLI setup can skip app-level Git identity", async () => {
  const paths = tempSetupPaths()
  try {
    const config = { ...defaultAppConfig(), dataDir: paths.dataDir }
    writeConfigFile(paths.configPath, config)

    await maybeConfigureGitIdentityInteractive(paths.configPath, config, {
      createQuestioner: () => fakeQuestioner(["n"]),
    })

    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    assert.equal(state.kind === "ok" ? state.config.gitIdentityDefault : undefined, undefined)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("interactive CLI setup prefills global Git identity without writing global config", async () => {
  const paths = tempSetupPaths()
  try {
    const gitBin = makeStubBin(paths.binDir, "git", `
printf '%s\n' "$*" >> "${paths.gitLogPath}"
if [ "$1" = "--version" ]; then
  echo "git version 2.47.0"
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "--global" ] && [ "$3" = "--get" ] && [ "$4" = "user.name" ]; then
  echo "Global Person"
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "--global" ] && [ "$3" = "--get" ] && [ "$4" = "user.email" ]; then
  echo "global@example.test"
  exit 0
fi
exit 1`)
    const config = { ...defaultAppConfig(), dataDir: paths.dataDir }
    writeConfigFile(paths.configPath, config)
    const prompts: string[] = []

    await maybeConfigureGitIdentityInteractive(paths.configPath, config, {
      gitCommandOptions: { gitBin },
      createQuestioner: () => fakeQuestioner(["", "", ""], prompts),
    })

    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    assert.deepEqual(state.kind === "ok" ? state.config.gitIdentityDefault : undefined, {
      displayName: "Global Person",
      email: "global@example.test",
      localOnly: false,
    })
    assert.equal(prompts.some(prompt => prompt.includes("[Global Person]")), true)
    assert.equal(prompts.some(prompt => prompt.includes("[global@example.test]")), true)
    const gitLog = readFileSync(paths.gitLogPath, "utf8")
    assert.doesNotMatch(gitLog, /config --global user\.name/)
    assert.doesNotMatch(gitLog, /config --global user\.email/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
