import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { fetchAppConfigView, fetchGitReadiness, fetchSetupReport } from "@/lib/setup/server";

export default async function SetupPage() {
  const [setup, config] = await Promise.all([fetchSetupReport(), fetchAppConfigView()]);
  const git = await fetchGitReadiness(config.data?.workspace?.id);
  return (
    <SetupWizardShell
      report={setup.data}
      configView={config.data}
      gitReadiness={git.data}
      gitError={git.error}
      error={setup.error ?? config.error}
    />
  );
}
