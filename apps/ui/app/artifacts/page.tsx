import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Panel } from "@/components/primitives/Panel";
import { SectionTitle } from "@/components/primitives/SectionTitle";
import { shellViewModel } from "@/lib/mock-data";

export default function ArtifactsPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/artifacts">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Artifacts"
          description="Artifacts stays intentionally lightweight in V1 and can adopt the same panel and row system once real data wiring lands."
        />
        <EmptyState title="Artifacts view queued" detail="Artifact list and detail handlers should reuse the workspace-first shell instead of introducing new layout chrome." />
      </Panel>
    </AppShell>
  );
}
