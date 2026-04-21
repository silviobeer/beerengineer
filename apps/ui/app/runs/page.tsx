import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Panel } from "@/components/primitives/Panel";
import { SectionTitle } from "@/components/primitives/SectionTitle";
import { shellViewModel } from "@/lib/mock-data";

export default function RunsPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/runs">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Runs"
          description="Shared shell primitives are in place; run and execution views can now reuse the same list and detail surfaces."
        />
        <EmptyState title="Runs view queued" detail="The next slice should connect run summaries and details to structured workflowService handlers." />
      </Panel>
    </AppShell>
  );
}
