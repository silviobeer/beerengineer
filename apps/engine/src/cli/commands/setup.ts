import { withRepos } from "../common.js"
import { getAppConfigView } from "../../setup/appConfigView.js"

export async function runSetupTelegramStatusCommand(workspaceKey?: string, json = false): Promise<number> {
  return withRepos(async repos => {
    const view = getAppConfigView({}, { repos, workspaceKey })
    if (workspaceKey && !view.workspace) {
      console.error(`  Workspace not found: ${workspaceKey}`)
      return 1
    }
    if (!view.telegramInbound) {
      console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
      return 1
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(view.telegramInbound)}\n`)
      return view.telegramInbound.readiness.state === "ready" ? 0 : 1
    }

    console.log(`  Telegram inbound replies: ${view.telegramInbound.readiness.state}`)
    console.log(`  Scope: ${view.telegramInbound.scope.description}`)
    console.log(renderField(
      "Bot configuration",
      view.telegramInbound.fields.bot.source,
      [
        `enabled=${yesNo(view.telegramInbound.fields.bot.enabled)}`,
        `tokenRef=${view.telegramInbound.fields.bot.tokenRef ?? "missing"}`,
        `tokenPresent=${yesNo(view.telegramInbound.fields.bot.tokenPresent)}`,
      ],
    ))
    console.log(renderField(
      "Chat configuration",
      view.telegramInbound.fields.chat.source,
      [`chatId=${view.telegramInbound.fields.chat.chatId ?? "missing"}`],
    ))
    console.log(renderField(
      "Webhook secret presence",
      view.telegramInbound.fields.webhookSecret.source,
      [
        `enabled=${yesNo(view.telegramInbound.fields.webhookSecret.enabled)}`,
        `secretRef=${view.telegramInbound.fields.webhookSecret.secretRef ?? "missing"}`,
        `present=${yesNo(view.telegramInbound.fields.webhookSecret.secretPresent)}`,
      ],
    ))
    console.log(renderField(
      "Public webhook configuration",
      view.telegramInbound.fields.publicWebhook.source,
      [
        `publicBaseUrl=${view.telegramInbound.fields.publicWebhook.publicBaseUrl ?? "missing"}`,
        `valid=${yesNo(view.telegramInbound.fields.publicWebhook.valid)}`,
        `webhookUrl=${view.telegramInbound.fields.publicWebhook.webhookUrl ?? "unavailable"}`,
      ],
    ))
    if (view.telegramInbound.readiness.blockers.length > 0) {
      console.log("  Blockers:")
      for (const blocker of view.telegramInbound.readiness.blockers) console.log(`    - ${blocker}`)
      return 1
    }
    console.log("  Blockers: none")
    return 0
  })
}

function renderField(label: string, source: string, details: string[]): string {
  return `  ${label}: source=${source}; ${details.join("; ")}`
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no"
}
