import { PathInput } from "@/components/setup/PathInput";

export function WorkspaceRootForm() {
  return (
    <div className="form-card">
      <h3>Repair workspace root</h3>
      <PathInput label="Root path" defaultValue="/home/silvio/projects/beerengineer" />
    </div>
  );
}
