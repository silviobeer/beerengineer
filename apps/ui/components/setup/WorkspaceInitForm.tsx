import { BootstrapOptionToggle } from "@/components/setup/BootstrapOptionToggle";

export function WorkspaceInitForm() {
  return (
    <div className="form-card">
      <h3>Initialize workspace</h3>
      <div className="toggle-list">
        <BootstrapOptionToggle label="create root" />
        <BootstrapOptionToggle label="init git" defaultChecked={false} />
        <BootstrapOptionToggle label="dry run" defaultChecked={false} />
      </div>
    </div>
  );
}
