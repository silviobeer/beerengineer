import { IMPLEMENTATION_STAGES, type ImplementationStage } from "../lib/types";

interface MiniStepperProps {
  stage?: string | null;
}

const SEGMENT_LABELS: Record<ImplementationStage, string> = {
  arch: "Arch",
  plan: "Plan",
  exec: "Exec",
  review: "Review",
};

function isKnownStage(value: unknown): value is ImplementationStage {
  return (
    typeof value === "string" &&
    (IMPLEMENTATION_STAGES as readonly string[]).includes(value)
  );
}

export function MiniStepper({ stage }: MiniStepperProps) {
  const activeStage = isKnownStage(stage) ? stage : null;

  return (
    <ol
      data-testid="mini-stepper"
      role="list"
      aria-label="Implementation progress"
      className="flex items-center gap-1"
    >
      {IMPLEMENTATION_STAGES.map((segment) => {
        const active = segment === activeStage;
        return (
          <li
            key={segment}
            role="listitem"
            data-testid={`mini-stepper-segment-${segment}`}
            data-segment={segment}
            data-active={active ? "true" : "false"}
            aria-current={active ? "step" : undefined}
            className={
              active
                ? "inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider border border-emerald-400 bg-emerald-500/15 text-emerald-300 font-mono"
                : "inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-500 font-mono"
            }
          >
            {SEGMENT_LABELS[segment]}
          </li>
        );
      })}
    </ol>
  );
}
