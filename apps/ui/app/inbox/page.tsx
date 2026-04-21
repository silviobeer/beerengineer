import { InboxView } from "@/components/inbox/InboxView";
import { AppShell } from "@/components/shell/AppShell";
import { inboxViewModel, shellViewModel } from "@/lib/mock-legacy-data";

export default function InboxPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/inbox">
      <InboxView inbox={inboxViewModel} />
    </AppShell>
  );
}
