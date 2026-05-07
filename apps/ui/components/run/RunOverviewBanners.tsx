import { RetainedBranchBanner } from "@/components/banners/RetainedBranchBanner";
import { PlanLimitBanner } from "@/components/banners/PlanLimitBanner";

type RunOverviewBannersProps = {
  costRisk?: { retainedBranchCount: number; planLimitRatio: number };
  recoveryUserMessage?: string | null;
};

export function RunOverviewBanners({ costRisk, recoveryUserMessage }: Readonly<RunOverviewBannersProps>) {
  if (!costRisk && !recoveryUserMessage) return null;
  return (
    <div className="space-y-3 px-4 pt-4 sm:px-6" data-testid="run-overview-banners">
      {recoveryUserMessage ? (
        <div className="border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          {recoveryUserMessage}
        </div>
      ) : null}
      {costRisk ? (
        <>
          <RetainedBranchBanner count={costRisk.retainedBranchCount} deepLinkHref="#supabase-diagnosis" />
          <PlanLimitBanner ratio={costRisk.planLimitRatio} />
        </>
      ) : null}
    </div>
  );
}
