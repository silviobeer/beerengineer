import { STAGE_KEYS, STAGE_LABELS, type StageKey } from "./types";

const STAGE_KEY_SET: ReadonlySet<string> = new Set<string>(STAGE_KEYS);

function stageLabel(stage: string | null | undefined): string | null {
  if (stage && STAGE_KEY_SET.has(stage)) {
    return STAGE_LABELS[stage as StageKey];
  }
  return null;
}

export function deriveStatusLabel(
  phaseStatus: string | null | undefined,
  currentStage?: string | null
): string {
  const status = (phaseStatus ?? "").trim();
  const stage = stageLabel(currentStage);

  switch (status) {
    case "running":
      return stage ? `Running – ${stage}` : "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "blocked":
    case "run-blocked":
      return "Blocked";
    case "review":
    case "review-gate-waiting":
      return "Awaiting Review";
    case "prompt":
    case "openPrompt":
      return "Awaiting Input";
    case "idle":
      return "Idle";
    case "":
      return "Unknown";
    default:
      return status;
  }
}
