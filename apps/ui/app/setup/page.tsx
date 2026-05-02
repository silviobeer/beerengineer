import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { fetchSetupReport } from "@/lib/setup/server";

export default async function SetupPage() {
  const { data, error } = await fetchSetupReport();
  return <SetupWizardShell report={data} error={error} />;
}
