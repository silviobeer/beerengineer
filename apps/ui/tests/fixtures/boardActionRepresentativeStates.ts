import { makeBoardCardFixture } from "@/lib/fixtures";
import type { BoardCardDTO } from "@/lib/types";

export type RepresentativeBoardActionState = {
  id: string;
  matrixKey: string;
  card: BoardCardDTO;
};

export const representativeBoardActionStates: RepresentativeBoardActionState[] = [
  {
    id: "blocked_merge_review_required",
    matrixKey: "merge/review_required",
    card: makeBoardCardFixture({
      id: "item-blocked",
      itemCode: "UI-BLOCKED",
      title: "Blocked merge item",
      column: "merge",
      phase_status: "review_required",
      current_stage: null,
      hasOpenPrompt: false,
      hasReviewGateWaiting: true,
      hasBlockedRun: true,
    }),
  },
  {
    id: "recoverable_implementation_failed",
    matrixKey: "implementation/failed",
    card: makeBoardCardFixture({
      id: "item-failed",
      itemCode: "UI-FAILED",
      title: "Recoverable implementation item",
      column: "implementation",
      phase_status: "failed",
      current_stage: "exec",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
    }),
  },
  {
    id: "running_implementation_running",
    matrixKey: "implementation/running",
    card: makeBoardCardFixture({
      id: "item-running",
      itemCode: "UI-RUNNING",
      title: "Running implementation item",
      column: "implementation",
      phase_status: "running",
      current_stage: "exec",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
    }),
  },
  {
    id: "terminal_done_completed",
    matrixKey: "done/completed",
    card: makeBoardCardFixture({
      id: "item-done",
      itemCode: "UI-DONE",
      title: "Completed terminal item",
      column: "done",
      phase_status: "completed",
      current_stage: null,
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
    }),
  },
];
