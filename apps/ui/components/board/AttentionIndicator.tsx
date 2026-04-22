import type { AttentionState, AttentionTone } from "@/lib/view-models";
import { AttentionIcon } from "@/components/board/BoardIcons";

const toneClass: Record<AttentionState, AttentionTone> = {
  idle: "muted",
  waiting: "gold",
  review: "gold",
  failed: "bad",
  done: "good",
  awaiting_answer: "gold",
  blocked: "warn",
  review_required: "gold",
  merge_ready: "petrol",
  ready_to_test: "petrol",
  running: "muted"
};

const labelMap: Record<AttentionState, string> = {
  idle: "draft",
  waiting: "waiting",
  review: "review",
  failed: "failed",
  done: "done",
  awaiting_answer: "Awaiting answer",
  blocked: "Blocked",
  review_required: "Review",
  merge_ready: "Merge ready",
  ready_to_test: "Ready to test",
  running: "running"
};

export function AttentionIndicator({ attention }: { attention: AttentionState }) {
  if (attention === "idle") {
    return <span className="attention-signal muted">draft</span>;
  }

  // Motion is the only signal for `running`; never a badge.
  if (attention === "running") {
    return null;
  }

  return (
    <span
      className={`attention-signal ${toneClass[attention]}`}
      aria-label={`Attention: ${labelMap[attention]}`}
    >
      <AttentionIcon attention={attention} />
      {labelMap[attention]}
    </span>
  );
}
