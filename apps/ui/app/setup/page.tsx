import { SetupOverview } from "@/components/setup/SetupOverview";
import { AppShell } from "@/components/shell/AppShell";
import { getSetupStatus } from "@/lib/api";
import { reportToSetupViewModel } from "@/lib/live-setup";
import {
  conversationMessages,
  setupViewModel as fallbackSetupViewModel,
  shellViewModel,
} from "@/lib/mock-legacy-data";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const report = await getSetupStatus().catch(() => null);
  const setup = report ? reportToSetupViewModel(report) : fallbackSetupViewModel;
  const liveBanner = report
    ? `Live — generated ${new Date(report.generatedAt).toLocaleString()}`
    : "Engine unreachable — showing last-known mock view.";

  return (
    <AppShell shell={shellViewModel} activeHref="/setup">
      <div data-setup-source={report ? "live" : "mock"} className="muted mono-label" style={{ marginBottom: "0.75rem" }}>
        {liveBanner}
      </div>
      <SetupOverview setup={setup} messages={conversationMessages} />
    </AppShell>
  );
}
