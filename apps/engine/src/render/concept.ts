import type { Concept } from "../types/domain.js"

function stringifyListValue(value: unknown): string {
  if (typeof value === "string") return value
  const serialized = JSON.stringify(value)
  return serialized ?? String(value)
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringifyListValue)
  if (value == null) return []
  if (typeof value === "string") return value.split(/\r?\n/).map(s => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(stringifyListValue)
  return [String(value)]
}

export function renderConceptMarkdown(concept: Concept & { hasUi?: boolean }): string {
  const users = toStringList(concept.users)
  const constraints = toStringList(concept.constraints)
  return [
    "# Concept",
    "",
    "## Summary",
    concept.summary ?? "",
    "",
    "## Problem",
    concept.problem ?? "",
    "",
    "## Users",
    ...users.map(user => `- ${user}`),
    "",
    "## Constraints",
    ...constraints.map(constraint => `- ${constraint}`),
    "",
    "## UI Signal",
    concept.hasUi ? "UI-bearing item" : "No UI identified",
    "",
  ].join("\n")
}
