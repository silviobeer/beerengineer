import type {
  SetupReport,
  SetupCheckResult,
  SetupGroupResult,
  SetupStatusValue,
} from "@/lib/api"
import type {
  SetupCategoryViewModel,
  SetupCheckViewModel,
  SetupViewModel,
} from "@/lib/view-models"

// Engine exposes 6 status values; the legacy UI view-model only models 5.
// "misconfigured" and "uninitialized" both become "warning" because the UI
// renders them identically (amber chip, remedy text in detail).
function mapStatus(status: SetupStatusValue): SetupCheckViewModel["status"] {
  switch (status) {
    case "ok":
      return "ok"
    case "missing":
      return "missing"
    case "skipped":
      return "not_applicable"
    case "unknown":
      return "blocked"
    case "misconfigured":
    case "uninitialized":
      return "warning"
  }
}

function overallLabel(overall: SetupReport["overall"]): string {
  switch (overall) {
    case "ok":
      return "Ready"
    case "warning":
      return "Needs attention"
    case "blocked":
      return "Blocked"
  }
}

function checkDetail(check: SetupCheckResult): string {
  const parts: string[] = []
  if (check.detail) parts.push(check.detail)
  if (check.version) parts.push(`version: ${check.version}`)
  if (check.remedy?.hint) parts.push(check.remedy.hint)
  return parts.join(" — ") || "No additional detail."
}

function summarizeGroup(group: SetupGroupResult): string {
  const total = group.checks.length
  const fail = total - group.passed
  const status = group.satisfied
    ? group.ideal
      ? "All checks passing."
      : "Minimum required checks met; recommended items still open."
    : `${fail} of ${total} checks need attention.`
  return `${status} (${group.level})`
}

function groupToCategory(group: SetupGroupResult): SetupCategoryViewModel {
  return {
    title: group.label,
    summary: summarizeGroup(group),
    checks: group.checks.map((check) => ({
      name: check.label,
      status: mapStatus(check.status),
      detail: checkDetail(check),
    })),
  }
}

// Suggested actions: hints attached to checks that still need work. Dedup by
// hint text so the sidebar doesn't repeat "install the Claude CLI" for every
// failing LLM check.
function collectSuggestedActions(report: SetupReport): string[] {
  const seen = new Set<string>()
  const actions: string[] = []
  for (const group of report.groups) {
    for (const check of group.checks) {
      if (check.status === "ok" || check.status === "skipped") continue
      const hint = check.remedy?.hint
      if (!hint || seen.has(hint)) continue
      seen.add(hint)
      actions.push(hint)
    }
  }
  return actions
}

// Auto-fixes: remedy commands from failing checks — operators can copy-paste
// these into a terminal. Dedup by command text.
function collectAutoFixes(report: SetupReport): string[] {
  const seen = new Set<string>()
  const fixes: string[] = []
  for (const group of report.groups) {
    for (const check of group.checks) {
      if (check.status === "ok" || check.status === "skipped") continue
      const cmd = check.remedy?.command
      if (!cmd || seen.has(cmd)) continue
      seen.add(cmd)
      fixes.push(cmd)
    }
  }
  return fixes
}

export function reportToSetupViewModel(report: SetupReport): SetupViewModel {
  return {
    heading: "Workspace setup overview",
    description:
      "Live diagnostics from the engine doctor — every group, check, and remedy reflects the current state of your environment.",
    overallStatus: overallLabel(report.overall),
    suggestedActions: collectSuggestedActions(report),
    autoFixes: collectAutoFixes(report),
    categories: report.groups.map(groupToCategory),
  }
}
