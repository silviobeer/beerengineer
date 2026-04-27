import {
  DESIGN_PREP_STAGES,
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
  mapEngineStageToDesignPrepSegment,
  mapEngineStageToImplementationSegment,
  type ImplementationStage,
} from "../lib/types";

interface MiniStepperProps {
  /**
   * Engine stageKey of the active sub-stage. The stepper highlights the
   * matching segment, or none when the stage is null/unknown.
   */
  stage?: string | null;
  /** Legacy alias kept for older call sites. */
  currentStage?: string | null;
  /** Legacy alias used by older tests and cards. */
  pipelineState?: string;
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

const STEPPER_FONT =
  "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const ACTIVE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 6px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  border: "1px solid #5fb6c2",
  backgroundColor: "rgba(14, 90, 101, 0.35)",
  color: "#9fd8e0",
  fontWeight: 700,
  fontFamily: STEPPER_FONT,
};

const INACTIVE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 6px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  border: "1px solid #1a2f33",
  backgroundColor: "#122024",
  color: "#6b8084",
  fontWeight: 400,
  fontFamily: STEPPER_FONT,
};

function isKnownStage(value: unknown, stages: ReadonlyArray<string>): value is string {
  return typeof value === "string" && stages.includes(value);
}

export function MiniStepper({
  stage,
  currentStage,
  pipelineState,
  stages = IMPLEMENTATION_STAGES,
  labels = IMPLEMENTATION_STAGE_LABELS,
  ariaLabel = "Implementation progress",
}: MiniStepperProps) {
  const resolvedStage = stage ?? currentStage ?? null;
  // The engine emits full stageKeys (`architecture`, `execution`,
  // `visual-companion`, …) but the implementation stepper uses 4 collapsed
  // segments (`arch`/`plan`/`exec`/`review`). Normalize through the
  // appropriate mapper based on the segment list the caller passed; for
  // unknown lists, fall back to direct matching (no transform).
  const normalizedStage =
    stages === IMPLEMENTATION_STAGES
      ? (mapEngineStageToImplementationSegment(resolvedStage) ?? resolvedStage)
      : stages === DESIGN_PREP_STAGES
      ? (mapEngineStageToDesignPrepSegment(resolvedStage) ?? resolvedStage)
      : resolvedStage;
  const activeStage = isKnownStage(normalizedStage, stages) ? normalizedStage : null;

  return (
    <ol
      data-testid="mini-stepper"
      role="list"
      aria-label={ariaLabel}
      data-state={pipelineState ?? ""}
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
