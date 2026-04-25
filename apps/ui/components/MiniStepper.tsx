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

const ACTIVE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 6px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  border: "1px solid rgb(52, 211, 153)",
  backgroundColor: "rgba(16, 185, 129, 0.15)",
  color: "rgb(110, 231, 183)",
  fontWeight: 700,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const INACTIVE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 6px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  border: "1px solid rgb(39, 39, 42)",
  backgroundColor: "rgb(24, 24, 27)",
  color: "rgb(113, 113, 122)",
  fontWeight: 400,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
      style={{ display: "flex", alignItems: "center", gap: "4px", listStyle: "none", padding: 0, margin: 0 }}
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
            style={active ? ACTIVE_STYLE : INACTIVE_STYLE}
          >
            {SEGMENT_LABELS[segment]}
          </li>
        );
      })}
    </ol>
  );
}
