#!/usr/bin/env node

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { sendTelegramTestNotification } from "./notifications/command.js"
import { runSetupCommand } from "./setup/doctor.js"
import { parseArgs, printHelp, validateGroup } from "./cli/parse.js"
import { loadEffectiveConfig, runDoctor, withRepos } from "./cli/common.js"
import { startEngine, startUi } from "./cli/ui.js"
import {
  runChatAnswerCommand,
  runChatListCommand,
  runChatSendCommand,
  runItemDesignCommand,
  runItemGetCommand,
  runItemOpenCommand,
  runItemPreviewCommand,
  runItemsCommand,
  runRunGetCommand,
  runRunListCommand,
  runRunMessagesCommand,
  runRunOpenCommand,
  runRunTailCommand,
  runRunWatchCommand,
  runStatusCommand,
  runWorkspaceItemsCommand,
  runItemWireframesCommand,
} from "./cli/commands/overview.js"
import {
  runWorkspaceAddCommand,
  runWorkspaceBackfillCommand,
  runWorkspaceGetCommand,
  runWorkspaceListCommand,
  runWorkspaceOpenCommand,
  runWorkspacePreviewCommand,
  runWorkspaceRemoveCommand,
  runWorkspaceUseCommand,
  runWorkspaceWorktreeGcCommand,
} from "./cli/commands/workspaces.js"
import { runItemAction, runItemImportPrepared } from "./cli/commands/itemActions.js"
import { runUpdateCommand } from "./cli/commands/update.js"
import { runInteractiveWorkflow } from "./cli/workflow.js"
import type { Command } from "./cli/types.js"

export { parseArgs } from "./cli/parse.js"
export { resolveItemReference, runDoctor } from "./cli/common.js"
export { resolveUiLaunchUrl, resolveUiWorkspacePath, startEngine, startUi } from "./cli/ui.js"
export { runItemAction } from "./cli/commands/itemActions.js"
export type { ResumeFlags } from "./cli/types.js"

async function runNotificationsTestCommand(channel: "telegram"): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  if (channel !== "telegram") {
    console.error(`  Unsupported notification channel: ${channel}`)
    return 2
  }
  return withRepos(async repos => {
    const result = await sendTelegramTestNotification(config, repos)
    if (!result.ok) {
      console.error(`  Telegram test failed: ${result.error}`)
      return 1
    }
    console.log("  Telegram test notification sent.")
    return 0
  })
}

type CommandHandlers = {
  [K in Command["kind"]]?: (cmd: Extract<Command, { kind: K }>) => Promise<number>
}

const COMMAND_REGISTRY: CommandHandlers = {
  "start-engine": async () => startEngine(),
  doctor: async cmd => {
    const exit = validateGroup(cmd.group)
    if (exit !== null) return exit
    return runDoctor({ json: cmd.json, group: cmd.group })
  },
  setup: async cmd => {
    const exit = validateGroup(cmd.group)
    if (exit !== null) return exit
    return runSetupCommand({ group: cmd.group, noInteractive: cmd.noInteractive })
  },
  update: cmd => runUpdateCommand(cmd),
  "notifications-test": cmd => runNotificationsTestCommand(cmd.channel),
  "workspace-preview": cmd => runWorkspacePreviewCommand(cmd.path, cmd.json),
  "workspace-add": cmd => runWorkspaceAddCommand(cmd),
  "workspace-list": cmd => runWorkspaceListCommand(cmd.json),
  "workspace-get": cmd => runWorkspaceGetCommand(cmd.key, cmd.json),
  "workspace-items": cmd => runWorkspaceItemsCommand(cmd.key, cmd.json),
  "workspace-use": cmd => runWorkspaceUseCommand(cmd.key),
  "workspace-remove": cmd => runWorkspaceRemoveCommand(cmd.key, cmd.purge, cmd.json, cmd.yes, cmd.noInteractive),
  "workspace-open": cmd => runWorkspaceOpenCommand(cmd.key),
  "workspace-backfill": cmd => runWorkspaceBackfillCommand(cmd.json),
  "workspace-worktree-gc": cmd => runWorkspaceWorktreeGcCommand(cmd.key, cmd.json),
  status: cmd => runStatusCommand(cmd.workspaceKey, cmd.all, cmd.json),
  "chat-list": cmd => runChatListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  chats: cmd => runChatListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "chat-send": cmd => runChatSendCommand(cmd),
  "chat-answer": cmd => runChatAnswerCommand(cmd),
  items: cmd => runItemsCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "item-get": cmd => runItemGetCommand(cmd.itemRef, cmd.workspaceKey, cmd.json),
  "item-open": cmd => runItemOpenCommand(cmd.itemRef, cmd.workspaceKey),
  "item-preview": cmd => runItemPreviewCommand(cmd.itemRef, cmd.workspaceKey, { start: cmd.start, stop: cmd.stop, open: cmd.open, json: cmd.json }),
  "item-wireframes": cmd => runItemWireframesCommand(cmd.itemRef, cmd.workspaceKey, cmd.open, cmd.json),
  "item-design": cmd => runItemDesignCommand(cmd.itemRef, cmd.workspaceKey, cmd.open, cmd.json),
  "item-import-prepared": cmd => runItemImportPrepared(cmd.itemRef, cmd.sourceDir, cmd.json),
  "run-list": cmd => runRunListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  runs: cmd => runRunListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "run-get": cmd => runRunGetCommand(cmd.runId, cmd.json),
  "run-open": cmd => runRunOpenCommand(cmd.runId),
  "run-tail": cmd => runRunTailCommand(cmd),
  "run-messages": cmd => runRunMessagesCommand(cmd),
  "run-watch": cmd => runRunWatchCommand(cmd),
  "start-ui": () => startUi(),
  "item-action": cmd => runItemAction(cmd.itemRef, cmd.action, cmd.resume),
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cmd = parseArgs(argv)

  if (cmd.kind === "help") {
    printHelp()
    return
  }
  if (cmd.kind === "unknown") {
    console.error(`  Unknown command: ${cmd.token}`)
    printHelp()
    process.exit(1)
  }
  if (cmd.kind === "workflow") {
    try {
      await runInteractiveWorkflow({ json: cmd.json, workspaceKey: cmd.workspaceKey })
    } catch (err) {
      if (cmd.json) {
        process.stderr.write(`${JSON.stringify({ type: "cli_error", message: (err as Error).message })}\n`)
      } else {
        console.error("\n  FEHLER:", (err as Error).message)
      }
      process.exit(1)
    }
    return
  }

  const handler = COMMAND_REGISTRY[cmd.kind]
  if (!handler) {
    console.error(`  No handler registered for command kind: ${cmd.kind}`)
    process.exit(1)
  }
  process.exit(await (handler as (c: Command) => Promise<number>)(cmd))
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isEntrypoint) {
  await main()
}
