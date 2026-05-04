import { Topbar } from "@/components/Topbar";
import { SonarSetupCard } from "@/components/setup/SonarSetupCard";
import type { AppConfigView, SetupReport } from "@/lib/setup/types";
import { AppConfigSection } from "./AppConfigSection";
import { SecretMaintenanceRow } from "./SecretMaintenanceRow";
import { SetupStatusSection } from "./SetupStatusSection";
import { SupabaseSettingsSection } from "./SupabaseSettingsSection";

export function AppSettingsPage({
  report,
  configView,
  error,
}: Readonly<{ report: SetupReport | null; configView: AppConfigView | null; error?: string | null }>) {
  const telegram = configView?.config.notifications.telegram;
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Topbar />
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <p className="font-mono text-xs uppercase text-zinc-500">/settings</p>
          <h1 className="font-display text-2xl">App settings</h1>
          <nav aria-label="Settings sections" className="flex flex-wrap gap-2 lg:flex-col">
            <a className="border border-zinc-800 px-3 py-2 text-sm text-amber-300" href="#setup-status">Setup status</a>
            <a className="border border-zinc-800 px-3 py-2 text-sm text-zinc-300" href="#app-config">App config</a>
            <a className="border border-zinc-800 px-3 py-2 text-sm text-zinc-300" href="#secrets">Secrets</a>
            <a className="border border-zinc-800 px-3 py-2 text-sm text-zinc-300" href="#supabase">Supabase</a>
            <a className="border border-zinc-800 px-3 py-2 text-sm text-zinc-300" href="#sonar">Sonar</a>
            <a className="border border-zinc-800 px-3 py-2 text-sm text-zinc-300" href="#optional-services">Optional services</a>
          </nav>
        </aside>
        <div className="space-y-8">
          {error ? <p className="border border-amber-700 bg-amber-900/30 p-3 text-sm text-amber-200">{error}</p> : null}
          <SetupStatusSection initialReport={report} />
          <AppConfigSection initialView={configView} />
          <section id="secrets" className="space-y-3" data-testid="settings-secrets">
            <div>
              <h2 className="font-display text-xl">Secrets</h2>
              <p className="text-sm text-zinc-400">Stored values stay redacted; only metadata is shown.</p>
            </div>
            <SecretMaintenanceRow label="LLM API key" secret={configView?.config.llm.apiKey} fallbackRef="ANTHROPIC_API_KEY" />
            <SecretMaintenanceRow label="Telegram bot token" secret={telegram?.botToken} fallbackRef="TELEGRAM_BOT_TOKEN" />
          </section>
          {configView ? <SupabaseSettingsSection supabase={configView.supabase} /> : null}
          <section id="sonar" className="space-y-3" data-testid="settings-sonar">
            <div>
              <h2 className="font-display text-xl">Sonar</h2>
              <p className="text-sm text-zinc-400">Optional review-gate configuration for workspaces that enable SonarCloud.</p>
            </div>
            <SonarSetupCard defaultOrganization={configView?.config.llm.defaultSonarOrganization} />
          </section>
          <section id="optional-services" className="space-y-3" data-testid="optional-services">
            <h2 className="font-display text-xl">Optional services</h2>
            <p className="text-sm text-zinc-400">Missing optional services can stay skipped or not configured without blocking required setup.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
