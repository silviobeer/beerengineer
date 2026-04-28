import { isKnownModel } from "../harness/models.js"
import presetsJson from "../harness/presets.json" with { type: "json" }
import type { SetupReport } from "../../setup/types.js"
import type { HarnessProfile, KnownHarness, ValidationResult } from "../../types/workspace.js"

type PresetRoleEntry = { harness: KnownHarness; runtime?: "cli" | "sdk" }
type PresetEntry = {
  coder: PresetRoleEntry
  reviewer: PresetRoleEntry
  "merge-resolver"?: PresetRoleEntry
}

const PRESETS = (presetsJson as { presets: Record<string, PresetEntry> }).presets

function pairsFromPreset(presetKey: string): Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> {
  const preset = PRESETS[presetKey]
  if (!preset) return []
  const roles: Array<PresetRoleEntry | undefined> = [preset.coder, preset.reviewer, preset["merge-resolver"]]
  return roles
    .filter((r): r is PresetRoleEntry => Boolean(r))
    .map(r => ({ harness: r.harness, runtime: r.runtime ?? "cli" }))
}

function rolePairsForProfile(
  profile: HarnessProfile,
): Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> {
  switch (profile.mode) {
    case "codex-first":
    case "fast":
    case "claude-first":
    case "codex-only":
    case "claude-only":
    case "claude-sdk-first":
    case "codex-sdk-first":
    case "opencode-china":
    case "opencode-euro":
      return pairsFromPreset(profile.mode)
    case "opencode":
      return [{ harness: "opencode", runtime: "cli" }]
    case "self": {
      const pairs: Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> = [
        { harness: profile.roles.coder.harness, runtime: profile.roles.coder.runtime ?? "cli" },
        { harness: profile.roles.reviewer.harness, runtime: profile.roles.reviewer.runtime ?? "cli" },
      ]
      const mr = profile.roles["merge-resolver"]
      if (mr) pairs.push({ harness: mr.harness, runtime: mr.runtime ?? "cli" })
      return pairs
    }
  }
}

function collectAvailableHarnesses(report: SetupReport): Set<KnownHarness> {
  const available = new Set<KnownHarness>()
  const byId = new Map(report.groups.flatMap(group => group.checks.map(check => [check.id, check.status] as const)))
  if (byId.get("llm.anthropic.cli") === "ok" && byId.get("llm.anthropic.auth") === "ok") available.add("claude")
  if (byId.get("llm.openai.cli") === "ok" && byId.get("llm.openai.auth") === "ok") available.add("codex")
  if (byId.get("llm.opencode.cli") === "ok" && byId.get("llm.opencode.auth") === "ok") available.add("opencode")
  return available
}

function sdkApiKeyEnv(harness: KnownHarness): string | null {
  const envByHarness: Partial<Record<KnownHarness, string>> = {
    claude: "ANTHROPIC_API_KEY",
    codex: "OPENAI_API_KEY",
  }
  return envByHarness[harness] ?? null
}

function missingSdkKeys(pairs: Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }>): string[] {
  const missingKeys: string[] = []
  for (const pair of pairs) {
    if (pair.runtime !== "sdk") continue
    const env = sdkApiKeyEnv(pair.harness)
    if (env && !process.env[env]) missingKeys.push(`${pair.harness}:sdk requires ${env}`)
  }
  return missingKeys
}

function appendUnknownModelWarnings(profile: HarnessProfile, warnings: string[]): void {
  if (profile.mode !== "opencode" && profile.mode !== "self") return
  for (const role of [profile.roles.coder, profile.roles.reviewer]) {
    if (!isKnownModel(role.provider, role.model)) {
      warnings.push(`Unknown ${role.provider} model "${role.model}" accepted for ${profile.mode} profile`)
    }
  }
}

export function validateHarnessProfile(profile: HarnessProfile, appReport: SetupReport): ValidationResult {
  const warnings: string[] = []
  const pairs = rolePairsForProfile(profile)
  const hardRejects = pairs.filter(p => p.harness === "opencode" && p.runtime === "sdk")
  if (hardRejects.length > 0) {
    const labels = Array.from(new Set(hardRejects.map(p => `${p.harness}:${p.runtime}`)))
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail: `Harness profile requests runtime(s) that are not implemented: ${labels.join(", ")}.`,
      },
    }
  }

  if (profile.mode === "self" && profile.roles["merge-resolver"]?.runtime === "sdk") {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail:
          "Harness profile sets merge-resolver runtime to sdk, which is not implemented (the resolver is sync; SDK adapters are async). " +
          'Set merge-resolver to runtime: "cli" — coder/reviewer SDK runtimes are unaffected.',
      },
    }
  }

  const available = collectAvailableHarnesses(appReport)
  const required = Array.from(new Set(pairs.filter(p => p.runtime === "cli").map(p => p.harness)))
  const missing = required.filter(harness => !available.has(harness))
  if (missing.length > 0) {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_harness",
        detail: `Harness profile requires unavailable harnesses: ${Array.from(new Set(missing)).join(", ")}`,
      },
    }
  }

  const missingKeys = missingSdkKeys(pairs)
  if (missingKeys.length > 0) {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail: `Harness profile selects an SDK runtime without the required API key: ${Array.from(new Set(missingKeys)).join("; ")}`,
      },
    }
  }
  appendUnknownModelWarnings(profile, warnings)
  return { ok: true, warnings }
}
