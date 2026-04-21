import type { Concept } from "../types/domain.js"

export function renderConceptMarkdown(concept: Concept): string {
  return [
    "# Concept",
    "",
    "## Summary",
    concept.summary,
    "",
    "## Problem",
    concept.problem,
    "",
    "## Users",
    ...concept.users.map(user => `- ${user}`),
    "",
    "## Constraints",
    ...concept.constraints.map(constraint => `- ${constraint}`),
    "",
  ].join("\n")
}
