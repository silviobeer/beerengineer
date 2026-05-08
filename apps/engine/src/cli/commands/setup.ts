import { withRepos } from "../common.js"
import { getAppConfigView } from "../../setup/appConfigView.js"
import type { TelegramInboundStatusView } from "../../setup/telegramInboundStatus.js"

export async function runSetupTelegramStatusCommand(workspaceKey?: string, json = false): Promise<number> {
  return withRepos(async repos => {
    const view = getAppConfigView({}, { repos, workspaceKey })
    if (workspaceKey && !view.workspace) return failSetupTelegramStatus(`  Workspace not found: ${workspaceKey}`)
    if (!view.telegramInbound) {
      return failSetupTelegramStatus("  App config is missing or invalid. Run `beerengineer setup` first.")
    }
    if (json) return writeJsonStatus(view.telegramInbound)
    return writeHumanStatus(view.telegramInbound)
  })
}

function failSetupTelegramStatus(message: string): number {
  console.error(message)
  return 1
}

function writeJsonStatus(status: TelegramInboundStatusView): number {
  process.stdout.write(`${JSON.stringify(status)}\n`)
  return readinessExitCode(status)
}

function writeHumanStatus(status: TelegramInboundStatusView): number {
  for (const line of renderTelegramInboundStatus(status)) console.log(line)
  return readinessExitCode(status)
}

function renderTelegramInboundStatus(status: TelegramInboundStatusView): string[] {
  return [
    `  Telegram inbound replies: ${status.readiness.state}`,
    `  Scope: ${status.scope.description}`,
    renderField("Bot configuration", status.fields.bot.source, [
      `enabled=${yesNo(status.fields.bot.enabled)}`,
      `tokenRef=${status.fields.bot.tokenRef ?? "missing"}`,
      `tokenPresent=${yesNo(status.fields.bot.tokenPresent)}`,
    ]),
    renderField("Chat configuration", status.fields.chat.source, [
      `chatId=${status.fields.chat.chatId ?? "missing"}`,
    ]),
    renderField("Webhook secret presence", status.fields.webhookSecret.source, [
      `enabled=${yesNo(status.fields.webhookSecret.enabled)}`,
      `secretRef=${status.fields.webhookSecret.secretRef ?? "missing"}`,
      `present=${yesNo(status.fields.webhookSecret.secretPresent)}`,
    ]),
    renderField("Public webhook configuration", status.fields.publicWebhook.source, [
      `publicBaseUrl=${status.fields.publicWebhook.publicBaseUrl ?? "missing"}`,
      `valid=${yesNo(status.fields.publicWebhook.valid)}`,
      `webhookUrl=${status.fields.publicWebhook.webhookUrl ?? "unavailable"}`,
    ]),
    ...renderBlockers(status),
  ]
}

function renderBlockers(status: TelegramInboundStatusView): string[] {
  if (status.readiness.blockers.length === 0) return ["  Blockers: none"]
  return ["  Blockers:", ...status.readiness.blockers.map(blocker => `    - ${blocker}`)]
}

function readinessExitCode(status: TelegramInboundStatusView): number {
  return status.readiness.state === "ready" ? 0 : 1
}

function renderField(label: string, source: string, details: string[]): string {
  return `  ${label}: source=${source}; ${details.join("; ")}`
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no"
}
