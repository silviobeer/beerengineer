import { StatusChip } from "./StatusChip";
import { BranchLifecycleStepper } from "./lifecycle/BranchLifecycleStepper";
import type { LifecycleStepState } from "@/lib/lifecycleEvents";

export type WaveRowDbRelevance = {
  value: boolean
  source: "explicit" | "override" | "detector"
  reason?: string
}

export type WaveRowBranch = {
  branchRef?: string;
  branchName?: string;
  projectRef?: string;
  runId?: string;
  workspaceId?: string;
  workspaceRoot?: string | null;
}

export function WaveRow({
  title,
  dbRelevance,
  lifecycleSteps,
  branch,
}: Readonly<{
  title: string;
  dbRelevance: WaveRowDbRelevance;
  lifecycleSteps?: LifecycleStepState[];
  branch?: WaveRowBranch;
}>) {
  const label = dbRelevance.value ? "DB" : "non-DB";
  const tooltip = `${dbRelevance.source}${dbRelevance.reason ? `: ${dbRelevance.reason}` : ""}`;
  return (
    <div className="space-y-3 border border-zinc-800 bg-zinc-950 p-3" data-testid="wave-row">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm text-zinc-100">{title}</span>
        <span title={tooltip} aria-label={`DB relevance ${tooltip}`}>
          <StatusChip state={label} />
        </span>
      </div>
      {dbRelevance.value && lifecycleSteps ? (
        <BranchLifecycleStepper
          steps={lifecycleSteps}
          branchRef={branch?.branchRef}
          branchName={branch?.branchName}
          projectRef={branch?.projectRef}
          runId={branch?.runId}
          workspaceId={branch?.workspaceId}
          workspaceRoot={branch?.workspaceRoot ?? undefined}
        />
      ) : null}
    </div>
  );
}
