import { SetupOverview } from "@/components/setup/SetupOverview";
import { AppShell } from "@/components/shell/AppShell";
import { conversationMessages, setupViewModel, shellViewModel } from "@/lib/mock-data";

export default function SetupPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/setup">
      <SetupOverview setup={setupViewModel} messages={conversationMessages} />
    </AppShell>
  );
}
