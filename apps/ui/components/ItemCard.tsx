import Link from "next/link";
import {
  DESIGN_PREP_STAGES,
  DESIGN_PREP_STAGE_LABELS,
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
  type Item,
} from "../lib/types";
import { hasAttentionDot, hasFailureIndicator } from "../lib/attention";
import { StatusChip } from "./StatusChip";
import { AttentionDot } from "./AttentionDot";
import { FailureIndicator } from "./FailureIndicator";
import { MiniStepper } from "./MiniStepper";

interface ItemCardProps {
  item: Item;
  workspaceKey: string;
}

export function ItemCard({ item, workspaceKey }: ItemCardProps) {
  const showAttention = hasAttentionDot(item);
  const showFailure = !showAttention && hasFailureIndicator(item);
  const stepperKind: "implementation" | "frontend" | null =
    item.phase === "Implementation"
      ? "implementation"
      : item.phase === "Frontend"
      ? "frontend"
      : null;
  const summary = item.summary && item.summary.length > 0 ? item.summary : null;

  return (
    <Link
      href={`/w/${workspaceKey}/items/${item.id}`}
      data-testid="item-card"
      data-item-id={item.id}
      className="block border border-zinc-800 bg-zinc-900/60 p-3 hover:bg-zinc-900 focus:outline focus:outline-1 focus:outline-zinc-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="item-code"
          className="font-mono text-xs text-zinc-400"
        >
          {item.itemCode}
        </span>
        {showAttention ? <AttentionDot /> : null}
        {showFailure ? <FailureIndicator /> : null}
      </div>
      <div
        data-testid="item-title"
        className="mt-1 text-sm text-zinc-100 break-words"
      >
        {item.title}
      </div>
      {summary !== null ? (
        <p
          data-testid="item-summary"
          className="mt-1 line-clamp-2 overflow-hidden text-xs text-zinc-400"
        >
          {summary}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <StatusChip
          state={item.pipelineState}
          currentStage={item.current_stage ?? null}
        />
      </div>
      {stepperKind === "implementation" ? (
        <MiniStepper
          pipelineState={item.pipelineState}
          currentStage={item.current_stage ?? null}
          stages={IMPLEMENTATION_STAGES}
          labels={IMPLEMENTATION_STAGE_LABELS}
          ariaLabel="Implementation progress"
        />
      ) : stepperKind === "frontend" ? (
        <MiniStepper
          pipelineState={item.pipelineState}
          currentStage={item.current_stage ?? null}
          stages={DESIGN_PREP_STAGES}
          labels={DESIGN_PREP_STAGE_LABELS}
          ariaLabel="Design-prep progress"
        />
      ) : null}
    </Link>
  );
}
