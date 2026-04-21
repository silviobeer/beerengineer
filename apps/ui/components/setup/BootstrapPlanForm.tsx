import { BootstrapOptionToggle } from "@/components/setup/BootstrapOptionToggle";
import { StackSelect } from "@/components/setup/StackSelect";

export function BootstrapPlanForm() {
  return (
    <div className="form-card">
      <h3>Bootstrap plan</h3>
      <StackSelect />
      <div className="toggle-list">
        <BootstrapOptionToggle label="scaffold project files" />
        <BootstrapOptionToggle label="install dependencies" />
        <BootstrapOptionToggle label="with Sonar" defaultChecked={false} />
        <BootstrapOptionToggle label="with CodeRabbit" />
        <BootstrapOptionToggle label="dry run" defaultChecked={false} />
      </div>
    </div>
  );
}
