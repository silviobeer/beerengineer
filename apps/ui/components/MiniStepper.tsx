import {
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
  type ImplementationStage,
} from "../lib/types";

interface MiniStepperProps {
  /**
   * Engine stageKey of the active sub-stage. The stepper highlights the
   * matching segment, or none when the stage is null/unknown.
   */
  stage?: string | null;
  /**
   * Sub-stage keys, in display order. Defaults to the implementation set
   * (`arch | plan | exec | review`) so existing call sites keep working.
   * Pass `DESIGN_PREP_STAGES` for the frontend column.
   */
  stages?: ReadonlyArray<string>;
  /** Labels keyed by stage. Defaults to the implementation labels. */
  labels?: Record<string, string>;
  /** Used for the aria-label on the <ol>. */
  ariaLabel?: string;
}

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

function isKnownStage(value: unknown, stages: ReadonlyArray<string>): value is string {
  return typeof value === "string" && stages.includes(value);
}

export function MiniStepper({
  stage,
  stages = IMPLEMENTATION_STAGES,
  labels = IMPLEMENTATION_STAGE_LABELS,
  ariaLabel = "Implementation progress",
}: MiniStepperProps) {
  const activeStage = isKnownStage(stage, stages) ? stage : null;

  return (
    <ol
      data-testid="mini-stepper"
      role="list"
      aria-label={ariaLabel}
      className="flex items-center gap-1"
      style={{ display: "flex", alignItems: "center", gap: "4px", listStyle: "none", padding: 0, margin: 0 }}
    >
      {stages.map((segment) => {
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
            {labels[segment] ?? segment}
          </li>
        );
      })}
    </ol>
  );
}

// Re-export so existing imports of ImplementationStage from this module still
// resolve through it; the canonical home is lib/types but BoardCard already
// imports from here in some test files.
export type { ImplementationStage };
