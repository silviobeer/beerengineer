import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import {
  renderDocFreshnessReport,
  type DocFreshnessFinding,
} from "./reporter.js"

type MaybePromise<T> = T | Promise<T>

type DocFreshnessWriter = {
  write(chunk: string): void
}

export type DocFreshnessRunnerOptions = {
  collectFindings?: () => MaybePromise<readonly DocFreshnessFinding[]>
  stdout?: DocFreshnessWriter
  stderr?: DocFreshnessWriter
}

export async function runDocFreshnessReport(options: DocFreshnessRunnerOptions = {}): Promise<number> {
  const findings = [...await (options.collectFindings?.() ?? [])]
  const report = renderDocFreshnessReport(findings)
  const writer = findings.length === 0
    ? (options.stdout ?? process.stdout)
    : (options.stderr ?? process.stderr)

  writer.write(`${report}\n`)
  return findings.length === 0 ? 0 : 1
}

export async function main(): Promise<void> {
  const exitCode = await runDocFreshnessReport()
  process.exit(exitCode)
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  await main()
}
