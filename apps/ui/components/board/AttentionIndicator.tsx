import type { AttentionState } from "@/lib/view-models";
import { AttentionIcon } from "@/components/board/BoardIcons";

const toneClass: Record<AttentionState, string> = {
  waiting: "gold",
  review: "gold",
  failed: "bad",
  done: "good",
  idle: "muted"
};

export function AttentionIndicator({ attention }: { attention: AttentionState }) {
  if (attention === "idle") {
    return <span className="attention-signal muted">draft</span>;
  }

  return (
    <span className={`attention-signal ${toneClass[attention]}`} aria-label={`Attention: ${attention}`}>
      <AttentionIcon attention={attention} />
      {attention}
    </span>
  );
}
