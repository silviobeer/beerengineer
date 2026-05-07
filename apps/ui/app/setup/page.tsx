import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { fetchAppConfigView, fetchGitReadiness, fetchSetupReport, resolveSetupGitReadinessWorkspaceId } from "@/lib/setup/server";

export default async function SetupPage() {
  const [setup, config] = await Promise.all([fetchSetupReport(), fetchAppConfigView()]);
  const workspaceId = await resolveSetupGitReadinessWorkspaceId(config.data);
  const git = await fetchGitReadiness(workspaceId);
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
