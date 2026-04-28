import type { CheckResult } from "../types.js"
import { createCheck, probeCommand, remedyForTool } from "./shared.js"

export async function runBrowserChecks(enabled: boolean): Promise<CheckResult[]> {
  if (!enabled) {
    return [
      createCheck("browser.playwright", "Playwright CLI + browser probe", "skipped", "browser automation is disabled in config"),
      createCheck("browser.agent-browser", "agent-browser CLI", "skipped", "browser automation is disabled in config"),
    ]
  }

  const playwright = await probeCommand("playwright", ["--version"])
  const agentBrowser = await probeCommand("agent-browser", ["--version"])
  return [
    createCheck("browser.playwright", "Playwright CLI + browser probe", playwright.ok ? "ok" : "missing", playwright.version ?? playwright.detail, {
      remedy: playwright.ok ? undefined : remedyForTool("playwright"),
    }),
    createCheck("browser.agent-browser", "agent-browser CLI", agentBrowser.ok ? "ok" : "missing", agentBrowser.version ?? agentBrowser.detail, {
      remedy: agentBrowser.ok ? undefined : remedyForTool("agent-browser"),
    }),
  ]
}
