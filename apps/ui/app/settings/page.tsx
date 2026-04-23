import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/primitives/Panel";
import { SectionTitle } from "@/components/primitives/SectionTitle";
import { TelegramTestButton } from "@/components/settings/TelegramTestButton";
import { shellViewModel } from "@/lib/mock-legacy-data";
import { findSetupGroup, getNotificationDeliveries, getSetupStatus } from "@/lib/api";

function statusLabel(value: string | undefined): string {
  return (value ?? "unknown").replaceAll("-", " ");
}

function formatTimestamp(value: number | null): string {
  if (!value) return "Never"
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function SettingsPage() {
  const report = await getSetupStatus("notifications");
  const group = findSetupGroup(report, "notifications");
  const checks = new Map((group?.checks ?? []).map(check => [check.id, check]));
  const deliveries = await getNotificationDeliveries({ channel: "telegram", limit: 8 });

  return (
    <AppShell shell={shellViewModel} activeHref="/settings">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Settings"
          description="Settings keeps the same shell chrome and remains scoped to the active workspace."
        />
        <div className="settings-grid">
          <div className="form-card">
            <h3>Telegram notifications</h3>
            <div className="settings-list">
              <div className="settings-row">
                <span>Group status</span>
                <strong>{group ? statusLabel(group.satisfied ? "ok" : report?.overall) : "unavailable"}</strong>
              </div>
              <div className="settings-row">
                <span>Enabled</span>
                <strong>{checks.get("notifications.telegram.enabled")?.detail ?? "Unavailable"}</strong>
              </div>
              <div className="settings-row">
                <span>Public base URL</span>
                <strong>{checks.get("notifications.public-base-url")?.detail ?? "Not configured"}</strong>
              </div>
              <div className="settings-row">
                <span>Bot token env</span>
                <strong>{checks.get("notifications.telegram.bot-token-env")?.detail ?? "Not configured"}</strong>
              </div>
              <div className="settings-row">
                <span>Bot token present</span>
                <strong>{statusLabel(checks.get("notifications.telegram.bot-token-present")?.status)}</strong>
              </div>
              <div className="settings-row">
                <span>Default chat id</span>
                <strong>{checks.get("notifications.telegram.default-chat-id")?.detail ?? "Not configured"}</strong>
              </div>
            </div>
          </div>
          <div className="form-card">
            <h3>Operator actions</h3>
            <p>Setup and delivery still belong to the engine process. The UI only reflects status.</p>
            <TelegramTestButton />
            <p>Run <code>beerengineer notifications test telegram</code> from the CLI to send the same smoke-test message from the terminal.</p>
            <p>Run <code>beerengineer setup --group notifications</code> to reconfigure the Telegram settings interactively.</p>
          </div>
        </div>
        <div className="form-card compact-top">
          <h3>Recent delivery history</h3>
          {deliveries.length === 0 ? (
            <p>No Telegram deliveries recorded yet.</p>
          ) : (
            <div className="settings-history">
              {deliveries.map(delivery => (
                <div key={delivery.dedup_key} className="settings-history-row">
                  <div className="settings-history-main">
                    <strong>{delivery.status}</strong>
                    <span>{delivery.dedup_key}</span>
                  </div>
                  <div className="settings-history-meta">
                    <span>Attempts: {delivery.attempt_count}</span>
                    <span>Last attempt: {formatTimestamp(delivery.last_attempt_at)}</span>
                    {delivery.error_message ? <span>Error: {delivery.error_message}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
