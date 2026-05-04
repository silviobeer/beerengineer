import { RetainedBranchBanner } from "@/components/banners/RetainedBranchBanner";
import { PlanLimitBanner } from "@/components/banners/PlanLimitBanner";

export function RunOverviewBanners({ costRisk }: Readonly<{ costRisk?: { retainedBranchCount: number; planLimitRatio: number } }>) {
  if (!costRisk) return null;
  return (
    <div className="space-y-3 px-4 pt-4 sm:px-6" data-testid="run-overview-banners">
      <RetainedBranchBanner count={costRisk.retainedBranchCount} deepLinkHref="#supabase-diagnosis" />
      <PlanLimitBanner ratio={costRisk.planLimitRatio} />
    </div>
  );
}
