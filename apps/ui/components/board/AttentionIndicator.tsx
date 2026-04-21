import type { AttentionState } from "@/lib/view-models";

export function AttentionIndicator({ attention }: { attention: AttentionState }) {
  return <span className={`attention-pill attention-${attention}`}>{attention}</span>;
}
