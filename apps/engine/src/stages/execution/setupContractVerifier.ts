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

function verifyRequiredScripts(workspaceRoot: string, requiredScripts: string[]): string[] {
  if (requiredScripts.length === 0) return []
  const packageJsonPath = join(workspaceRoot, "package.json")
  if (!existsSync(packageJsonPath)) {
    return ["missing package.json required to verify setup scripts"]
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> }
  const failures: string[] = []
  for (const requiredScript of requiredScripts) {
    const scriptName = packageScriptName(requiredScript)
    if (!packageJson.scripts?.[scriptName]) {
      failures.push(`missing required package.json script: ${scriptName}`)
      continue
    }
    const run = runShell(npmScriptCommand(scriptName), workspaceRoot)
    if (!run.ok) {
      failures.push(`script failed: ${npmScriptCommand(scriptName)}${formatCommandOutput(run.output)}`)
    }
  }
  return failures
}

function packageScriptName(requiredScript: string): string {
  const trimmed = requiredScript.trim()
  const npmRun = /^npm\s+run\s+(?:--\s+)?([^\s]+)$/.exec(trimmed)
  if (npmRun) return npmRun[1]
  const npmLifecycle = /^npm\s+([^\s]+)$/.exec(trimmed)
  if (npmLifecycle) return npmLifecycle[1]
  return trimmed
}

function npmScriptCommand(scriptName: string): string {
  return `npm run ${shellQuote(scriptName)}`
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
