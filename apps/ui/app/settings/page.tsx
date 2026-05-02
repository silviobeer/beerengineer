import { AppSettingsPage } from "@/components/settings/AppSettingsPage";
import { fetchAppConfigView, fetchSetupReport } from "@/lib/setup/server";

export default async function SettingsPage() {
  const [setup, config] = await Promise.all([fetchSetupReport(), fetchAppConfigView()]);
  const error = [setup.error, config.error].filter(Boolean).join(" ");
  return <AppSettingsPage report={setup.data} configView={config.data} error={error || null} />;
}
