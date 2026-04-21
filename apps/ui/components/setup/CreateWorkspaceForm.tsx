import { PathInput } from "@/components/setup/PathInput";

export function CreateWorkspaceForm() {
  return (
    <div className="form-card">
      <h3>Create workspace</h3>
      <label className="form-field">
        <span>Key</span>
        <input type="text" defaultValue="beerengineer-cli-ui-prep" />
      </label>
      <label className="form-field">
        <span>Name</span>
        <input type="text" defaultValue="BeerEngineer CLI UI Prep" />
      </label>
      <label className="form-field">
        <span>Description</span>
        <textarea rows={3} defaultValue="Workspace for the UI shell and setup control surfaces." />
      </label>
      <PathInput label="Root path" defaultValue="/home/silvio/projects/beerengineer" />
    </div>
  );
}
