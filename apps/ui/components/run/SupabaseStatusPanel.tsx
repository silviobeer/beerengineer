"use client";

import { useContext, useMemo } from "react";
import { lifecycleStepsFromBranchState } from "@/lib/lifecycleEvents";
import { SSEContext } from "@/lib/sse/SSEContext";
import type { BoardCardDTO } from "@/lib/types";
import { WaveRow } from "../WaveRow";
import { MergeGatePanel, type MergeGatePanelProps } from "../merge/MergeGatePanel";

export function SupabaseStatusPanel({
  card,
  gates,
  mergeStatusError,
}: Readonly<{
  card: BoardCardDTO;
  gates: MergeGatePanelProps["gates"] | null;
  mergeStatusError: string | null;
}>) {
  const sse = useContext(SSEContext);
  const dbRelevance = card.dbRelevance ?? {
    value: Boolean(card.supabaseBranch),
    source: "detector" as const,
    reason: card.supabaseBranch ? "Supabase branch provisioned" : "No Supabase branch provisioned",
  };
  const liveSteps = useMemo(() => {
    const states = Object.values(sse?.lifecycleState ?? {});
    return states.find(steps => steps.length > 0);
  }, [sse?.lifecycleState]);
  const lifecycleSteps = liveSteps ?? lifecycleStepsFromBranchState(card.supabaseBranch?.lifecycleState);
  const shouldRender = Boolean(card.dbRelevance || card.supabaseBranch || card.latestRunId);
  if (!shouldRender) return null;

  return (
    <div className="space-y-3 border border-zinc-800 bg-zinc-950/40 p-3">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500">Supabase status</h3>
      <WaveRow
        title="Latest run"
        dbRelevance={dbRelevance}
        lifecycleSteps={lifecycleSteps}
        branch={{
          branchRef: card.supabaseBranch?.ref,
          branchName: card.supabaseBranch?.name,
          projectRef: card.supabaseProjectRef ?? undefined,
          runId: card.latestRunId,
          workspaceId: card.workspaceId,
          workspaceRoot: card.workspaceRoot,
        }}
      />
      {card.column === "merge" && gates ? <MergeGatePanel gates={gates} /> : null}
      {card.column === "merge" && mergeStatusError ? <p className="text-xs text-amber-300">{mergeStatusError}</p> : null}
    </div>
  );
}
