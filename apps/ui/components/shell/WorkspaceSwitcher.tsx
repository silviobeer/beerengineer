import type { WorkspaceSummary } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";

export function WorkspaceSwitcher({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <div className="workspace-switcher">
      <MonoLabel>Active workspace</MonoLabel>
      <strong>{workspace.name}</strong>
      <span>{workspace.descriptor}</span>
    </div>
  );
}
