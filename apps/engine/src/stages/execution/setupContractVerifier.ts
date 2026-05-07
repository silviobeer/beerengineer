import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import type { StoryExecutionContext } from "../../types.js"

function runShell(command: string, cwd: string): { ok: boolean; output: string } {
  const result = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  }
}

export function verifySetupContract(
  workspaceRoot: string,
  contract: NonNullable<StoryExecutionContext["setupContract"]>,
): string[] {
  return [
    ...verifyExpectedFiles(workspaceRoot, contract.expectedFiles),
    ...verifyRequiredScripts(workspaceRoot, contract.requiredScripts),
    ...verifyPostChecks(workspaceRoot, contract.postChecks),
  ]
}

function verifyExpectedFiles(workspaceRoot: string, expectedFiles: string[]): string[] {
  const failures: string[] = []
  for (const expectedFile of expectedFiles) {
    if (/\s/.test(expectedFile)) continue
    if (!existsSync(join(workspaceRoot, expectedFile))) {
      failures.push(`missing expected file: ${expectedFile}`)
    }
  }
  return failures
}

type ParsedScript =
  | { kind: "workspace"; scriptName: string; workspaceKey: string; runCommand: string }
  | { kind: "root"; scriptName: string; runCommand: string }

function parseRequiredScript(requiredScript: string): ParsedScript {
  const trimmed = requiredScript.trim()
  // npm <lifecycle> --workspace=<pkg> (with optional extra flags)
  const wsLifecycle = /^npm\s+([^\s-][^\s]*)\s+.*--workspace[=\s](\S+)/.exec(trimmed)
  if (wsLifecycle) {
    return { kind: "workspace", scriptName: wsLifecycle[1], workspaceKey: wsLifecycle[2], runCommand: trimmed }
  }
  // npm run <name> (no workspace flag)
  const npmRun = /^npm\s+run\s+(?:--\s+)?([^\s]+)$/.exec(trimmed)
  if (npmRun) return { kind: "root", scriptName: npmRun[1], runCommand: `npm run ${shellQuote(npmRun[1])}` }
  // npm <lifecycle> (no workspace flag)
  const npmLifecycle = /^npm\s+([^\s]+)$/.exec(trimmed)
  if (npmLifecycle) return { kind: "root", scriptName: npmLifecycle[1], runCommand: `npm run ${shellQuote(npmLifecycle[1])}` }
  return { kind: "root", scriptName: trimmed, runCommand: `npm run ${shellQuote(trimmed)}` }
}

function resolvePackageJson(
  workspaceRoot: string,
  parsed: ParsedScript,
): { scripts?: Record<string, string> } | null {
  if (parsed.kind === "workspace") {
    const pkgBasename = parsed.workspaceKey.replace(/^@[^/]+\//, "")
    const candidates = [
      join(workspaceRoot, "apps", pkgBasename, "package.json"),
      join(workspaceRoot, "packages", pkgBasename, "package.json"),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return JSON.parse(readFileSync(candidate, "utf8")) as { scripts?: Record<string, string> }
      }
    }
    return null
  }
  const rootPath = join(workspaceRoot, "package.json")
  if (!existsSync(rootPath)) return null
  return JSON.parse(readFileSync(rootPath, "utf8")) as { scripts?: Record<string, string> }
}

function verifyRequiredScripts(workspaceRoot: string, requiredScripts: string[]): string[] {
  if (requiredScripts.length === 0) return []
  if (!existsSync(join(workspaceRoot, "package.json"))) {
    return ["missing package.json required to verify setup scripts"]
  }
  const failures: string[] = []
  for (const requiredScript of requiredScripts) {
    const parsed = parseRequiredScript(requiredScript)
    const pkgJson = resolvePackageJson(workspaceRoot, parsed)
    if (!pkgJson?.scripts?.[parsed.scriptName]) {
      failures.push(`missing required package.json script: ${parsed.scriptName}`)
      continue
    }
    const run = runShell(parsed.runCommand, workspaceRoot)
    if (!run.ok) {
      failures.push(`script failed: ${parsed.runCommand}${formatCommandOutput(run.output)}`)
    }
  }
  return failures
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function verifyPostChecks(workspaceRoot: string, postChecks: string[]): string[] {
  const failures: string[] = []
  for (const postCheck of postChecks) {
    const cmd = shellCommandFromPostCheck(postCheck)
    if (!cmd) continue
    const run = runShell(cmd, workspaceRoot)
    if (!run.ok) {
      failures.push(`post-check failed: ${cmd}${formatCommandOutput(run.output)}`)
    }
  }
  return failures
}

function shellCommandFromPostCheck(postCheck: string): string | null {
  const trimmed = postCheck.trim()
  if (!trimmed.startsWith("$ ") && !trimmed.startsWith("sh: ")) return null
  return trimmed.replace(/^\$\s+|^sh:\s+/, "")
}

function formatCommandOutput(output: string): string {
  return output ? `\n${output}` : ""
}
