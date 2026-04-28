const PHASE_LABELS: Record<string, string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  requirements: "Requirements",
  implementation: "Implementation",
  test: "Test",
  done: "Done",
  draft: "Draft",
  running: "Running",
  review_required: "Review",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};

const STAGE_LABELS: Record<string, string> = {
  brainstorm: "Brainstorm",
  "visual-companion": "Visual",
  "frontend-design": "Design",
  requirements: "Requirements",
  architecture: "Architecture",
  planning: "Planning",
  execution: "Execution",
  exec: "Exec",
  "project-review": "Review",
  qa: "QA",
  documentation: "Docs",
  handoff: "Handoff",
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

export function statusChipText(
  phaseStatus: string,
  currentStage: string | null,
): string {
  const phaseLabel = phaseStatus
    ? PHASE_LABELS[phaseStatus] ?? titleCase(phaseStatus)
    : "";
  if (!currentStage) return phaseLabel;
  const stageLabel = STAGE_LABELS[currentStage] ?? titleCase(currentStage);
  return `${phaseLabel} · ${stageLabel}`;
}
