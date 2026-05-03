import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { fetchAppConfigView, fetchSetupReport } from "@/lib/setup/server";

export default async function SetupPage() {
  const [setup, config] = await Promise.all([fetchSetupReport(), fetchAppConfigView()]);
  return <SetupWizardShell report={setup.data} configView={config.data} error={setup.error ?? config.error} />;
}
