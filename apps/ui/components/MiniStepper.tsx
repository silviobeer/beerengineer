import { STAGE_KEYS, STAGE_LABELS, type StageKey } from "../lib/types";

interface MiniStepperProps {
  pipelineState?: string;
  currentStage?: string | null;
}

const PIPELINE_STATE_TO_STAGE: Record<string, StageKey> = {
  idle: "arch",
  openPrompt: "plan",
  running: "exec",
  "run-blocked": "exec",
  "review-gate-waiting": "review",
};

function resolveActiveStage(
  currentStage: string | null | undefined,
  pipelineState: string | undefined
): StageKey | null {
  if (currentStage && (STAGE_KEYS as readonly string[]).includes(currentStage)) {
    return currentStage as StageKey;
  }
  if (pipelineState && PIPELINE_STATE_TO_STAGE[pipelineState]) {
    return PIPELINE_STATE_TO_STAGE[pipelineState];
  }
  return null;
}

export function MiniStepper({ pipelineState, currentStage }: MiniStepperProps) {
  const active = resolveActiveStage(currentStage, pipelineState);
  return (
    <div
      data-testid="mini-stepper"
      data-state={pipelineState ?? ""}
      data-active-stage={active ?? ""}
      className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider"
    >
      {STAGE_KEYS.map((key) => {
        const isActive = key === active;
        return (
          <span
            key={key}
            data-testid={`mini-stepper-segment-${key}`}
            data-stage={key}
            data-active={isActive ? "true" : "false"}
            className={
              isActive
                ? "text-amber-300 font-semibold"
                : "text-zinc-500 opacity-50"
            }
          >
            {isActive ? "▶ " : ""}
            {STAGE_LABELS[key]}
          </span>
        );
      })}
    </div>
  );
}
