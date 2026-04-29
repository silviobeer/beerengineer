import { KNOWN_GROUP_IDS } from "../setup/config.js"
import { messagingLevelFromQuery, type MessagingLevel } from "../core/messagingLevel.js"
import type { Command, ResumeFlags } from "./types.js"

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  if (idx === -1) return undefined
  return argv[idx + 1]
}

function isKnownGroupId(group: string): group is (typeof KNOWN_GROUP_IDS)[number] {
  return KNOWN_GROUP_IDS.includes(group as (typeof KNOWN_GROUP_IDS)[number])
}

type ParseArgsContext = {
  argv: string[]
  first: string | undefined
  second: string | undefined
  json: boolean
  group: string | undefined
  workspaceKey: string | undefined
  all: boolean
  compact: boolean
  since: string | undefined
  level: MessagingLevel
  messagesLevel: MessagingLevel
  limit: number
  positionalThird: string | undefined
}

function parseRunSubcommand(context: ParseArgsContext): Command | null {
  const { second, argv, workspaceKey, json, all, compact, level, messagesLevel, since, limit } = context
  if (context.first !== "run") return null
  if (second === undefined || second === "--json" || second === "--workspace" || second === "--verbose") {
    return { kind: "workflow", json, workspaceKey, verbose: argv.includes("--verbose") }
  }
  if (second === "list") return { kind: "run-list", workspaceKey, json, all, compact }
  if (second === "get") return { kind: "run-get", runId: argv[2], json }
  if (second === "open") return { kind: "run-open", runId: argv[2] }
  if (second === "tail") return { kind: "run-tail", runId: argv[2], level, since, json }
  if (second === "messages") return { kind: "run-messages", runId: argv[2], level: messagesLevel, since, limit, json }
  if (second === "watch") return { kind: "run-watch", runId: argv[2], level, since, json }
  return { kind: "unknown", token: argv.join(" ") }
}

function parseWorkspaceSubcommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, json } = context
  if (first !== "workspace") return null
  if (second === "preview") return { kind: "workspace-preview", path: argv[2], json }
  if (second === "add") {
    return {
      kind: "workspace-add",
      json,
      noInteractive: argv.includes("--no-interactive"),
      path: readFlag(argv, "--path") ?? argv[2],
      name: readFlag(argv, "--name"),
      key: readFlag(argv, "--key"),
      profile: readFlag(argv, "--profile"),
      profileJson: readFlag(argv, "--profile-json"),
      sonar: argv.includes("--sonar"),
      sonarKey: readFlag(argv, "--sonar-key"),
      sonarOrg: readFlag(argv, "--sonar-org"),
      sonarHost: readFlag(argv, "--sonar-host"),
      sonarToken: readFlag(argv, "--sonar-token"),
      sonarTokenPersist: !argv.includes("--no-sonar-token-persist"),
      noGit: argv.includes("--no-git"),
      ghCreate: argv.includes("--gh-create"),
      ghPublic: argv.includes("--gh-public"),
      ghOwner: readFlag(argv, "--gh-owner"),
    }
  }
  if (second === "list") return { kind: "workspace-list", json }
  if (second === "get") return { kind: "workspace-get", key: argv[2], json }
  if (second === "items") return { kind: "workspace-items", key: argv[2], json }
  if (second === "use") return { kind: "workspace-use", key: argv[2] }
  if (second === "remove") {
    return {
      kind: "workspace-remove",
      key: argv[2],
      json,
      purge: argv.includes("--purge"),
      yes: argv.includes("--yes"),
      noInteractive: argv.includes("--no-interactive"),
    }
  }
  if (second === "open") return { kind: "workspace-open", key: argv[2] }
  if (second === "backfill") return { kind: "workspace-backfill", json }
  if (second === "gc-worktrees") return { kind: "workspace-worktree-gc", key: argv[2], json }
  return null
}

function parseProjectAliasSubcommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, json } = context
  if (first === "projects" && (second === undefined || second === "--json")) return { kind: "workspace-list", json }
  if (first !== "project") return null
  if (second === "list") return { kind: "workspace-list", json }
  if (second === "get") return { kind: "workspace-get", key: argv[2], json }
  if (second === "items") return { kind: "workspace-items", key: argv[2], json }
  if (second === "open") return { kind: "workspace-open", key: argv[2] }
  return null
}

function parseChatSubcommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, json, workspaceKey, all, compact, positionalThird } = context
  if (first === "chat" && second === "list") return { kind: "chat-list", workspaceKey, json, all, compact }
  const positionalText = argv.slice(3).filter(part => !part.startsWith("--")).join(" ")
  if (first === "chat" && second === "send") {
    return {
      kind: "chat-send",
      runId: positionalThird ?? readFlag(argv, "--run"),
      text: positionalText || readFlag(argv, "--text"),
      json,
    }
  }
  if (first === "chat" && second === "answer") {
    const positionalRunId = positionalThird
    const positionalAnswer = positionalRunId ? positionalText || undefined : undefined
    return {
      kind: "chat-answer",
      promptId: readFlag(argv, "--prompt"),
      runId: readFlag(argv, "--run") ?? positionalRunId,
      answer: readFlag(argv, "--text") ?? positionalAnswer,
      multiline: argv.includes("--multiline"),
      editor: argv.includes("--editor"),
      json,
    }
  }
  return null
}

function resolveResumeFlags(argv: string[]): ResumeFlags {
  const resume: ResumeFlags = {}
  const summary = readFlag(argv, "--remediation-summary")
  const branch = readFlag(argv, "--branch")
  const commit = readFlag(argv, "--commit")
  const notes = readFlag(argv, "--notes")
  if (summary) resume.summary = summary
  if (branch) resume.branch = branch
  if (commit) resume.commit = commit
  if (notes) resume.notes = notes
  if (argv.includes("--yes")) resume.yes = true
  return resume
}

function parseItemActionSubcommand(argv: string[]): Command {
  const itemRef = readFlag(argv, "--item")
  const action = readFlag(argv, "--action")
  if (!itemRef || !action) return { kind: "unknown", token: argv.join(" ") }
  const resume = resolveResumeFlags(argv)
  return Object.keys(resume).length === 0
    ? { kind: "item-action", itemRef, action }
    : { kind: "item-action", itemRef, action, resume }
}

function parseItemSubcommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, workspaceKey, json } = context
  if (first !== "item") return null
  if (second === "import-prepared") {
    const itemRef = argv[2] && !argv[2].startsWith("--") ? argv[2] : undefined
    return { kind: "item-import-prepared", itemRef, sourceDir: readFlag(argv, "--from"), workspaceKey, json }
  }
  if (second === "get") return { kind: "item-get", itemRef: argv[2], workspaceKey, json }
  if (second === "open") return { kind: "item-open", itemRef: argv[2], workspaceKey }
  if (second === "preview") return { kind: "item-preview", itemRef: argv[2], workspaceKey, start: argv.includes("--start"), stop: argv.includes("--stop"), open: argv.includes("--open"), json }
  if (second === "wireframes") return { kind: "item-wireframes", itemRef: argv[2], workspaceKey, open: argv.includes("--open"), json }
  if (second === "design") return { kind: "item-design", itemRef: argv[2], workspaceKey, open: argv.includes("--open"), json }
  if (second === "action") return parseItemActionSubcommand(argv)
  return null
}

function buildParseArgsContext(argv: string[]): ParseArgsContext {
  const [first, second] = argv
  const json = argv.includes("--json")
  const group = readFlag(argv, "--group")
  const workspaceKey = readFlag(argv, "--workspace")
  const all = argv.includes("--all")
  const compact = argv.includes("--compact")
  const since = readFlag(argv, "--since")
  const level = messagingLevelFromQuery(readFlag(argv, "--level"), 1)
  const messagesLevel = messagingLevelFromQuery(readFlag(argv, "--level"), 2)
  const rawLimit = Number(readFlag(argv, "--limit") ?? 200)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200
  const positionalThird = argv[2] && !argv[2].startsWith("--") ? argv[2] : undefined
  return {
    argv,
    first,
    second,
    json,
    group,
    workspaceKey,
    all,
    compact,
    since,
    level,
    messagesLevel,
    limit,
    positionalThird,
  }
}

function parseUpdateCommand(context: ParseArgsContext): Command | null {
  if (context.first !== "update") return null
  return {
    kind: "update",
    check: context.argv.includes("--check"),
    json: context.json,
    dryRun: context.argv.includes("--dry-run"),
    rollback: context.argv.includes("--rollback"),
    version: readFlag(context.argv, "--version"),
    allowLegacyDbShadow: context.argv.includes("--allow-legacy-db-shadow"),
  }
}

function parsePluralListCommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, workspaceKey, json, all, compact, level, messagesLevel, since, limit } = context
  if (first === "items") return { kind: "items", workspaceKey, json, all, compact }
  if (first === "chats") return { kind: "chats", workspaceKey, json, all, compact }
  if (first !== "runs") return null
  if (second === "tail") return { kind: "run-tail", runId: argv[2], level, since, json }
  if (second === "messages") return { kind: "run-messages", runId: argv[2], level: messagesLevel, since, limit, json }
  if (second === "watch") return { kind: "run-watch", runId: argv[2], level, since, json }
  return { kind: "runs", workspaceKey, json, all, compact }
}

function parseSimpleTopLevelCommand(context: ParseArgsContext): Command | null {
  const { first, second, argv, json, group, workspaceKey, all } = context
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" }
  if (first === "--doctor" || first === "doctor") return { kind: "doctor", json, group }
  if (first === "setup") return { kind: "setup", group, noInteractive: argv.includes("--no-interactive") }
  const update = parseUpdateCommand(context)
  if (update) return update
  if (first === "notifications" && second === "test" && argv[2] === "telegram") return { kind: "notifications-test", channel: "telegram" }
  if (first === "status") return { kind: "status", workspaceKey, json, all }
  const pluralList = parsePluralListCommand(context)
  if (pluralList) return pluralList
  if (first === "start" && second === undefined) return { kind: "start-engine" }
  if (first === "start" && second === "ui") return { kind: "start-ui" }
  return null
}

export function parseArgs(argv: string[]): Command {
  const context = buildParseArgsContext(argv)
  const { first, json, workspaceKey } = context
  if (first === undefined || first === "--json" || first === "--workspace") {
    return { kind: "workflow", json, workspaceKey, verbose: argv.includes("--verbose") }
  }
  const delegated = parseRunSubcommand(context)
    ?? parseWorkspaceSubcommand(context)
    ?? parseProjectAliasSubcommand(context)
    ?? parseChatSubcommand(context)
    ?? parseItemSubcommand(context)
  if (delegated) return delegated
  const topLevel = parseSimpleTopLevelCommand(context)
  if (topLevel) return topLevel
  return { kind: "unknown", token: argv.join(" ") }
}

export function printHelp(): void {
  const lines = [
    "",
    "  beerengineer_ CLI",
    "",
    "  Usage:",
    "    beerengineer                                         Run the default workflow",
    "    beerengineer --json                                  Harness mode: NDJSON events on stdout, prompt answers on stdin",
    "    beerengineer run --json                              Same as `beerengineer --json`",
    "    beerengineer start                                   Start the local engine HTTP API (http://127.0.0.1:4100)",
    "    beerengineer start ui                                Start the local UI dev server (http://127.0.0.1:3100)",
    "    beerengineer status [--all] [--json]                Workspace status overview",
    "    beerengineer items [--all] [--compact]              List items",
    "    beerengineer chats [--all] [--compact]              List open chats",
    "    beerengineer runs [--all] [--compact]               List runs",
    "    beerengineer item action --item <id|code> --action <name>",
    "                                                         Perform an item action",
    "    beerengineer doctor [--json] [--group <id>]          Run machine diagnostics",
    "    beerengineer setup [--group <id>] [--no-interactive] Provision app config/data/DB and retry checks",
    "    beerengineer update [--json] [--version <tag>]       Stage and queue an update apply attempt",
    "    beerengineer update --check [--json]                 Check the newest GitHub release against the current install",
    "    beerengineer update --dry-run [--json]               Run update preflight checks without shutting the engine down",
    "    beerengineer update --rollback [--json]              Reserved; returns post-migration rollback unsupported",
    "    beerengineer notifications test telegram             Send a Telegram test notification",
    "    beerengineer workspace preview <path> [--json]       Preview workspace registration",
    "    beerengineer workspace add [--path <p>] [flags]      Register a workspace",
    "                                                         [--name <n>] [--key <k>] [--profile <json>|--profile-json <file>]",
    "                                                         [--sonar] [--sonar-token <t>] [--no-sonar-token-persist]",
    "                                                         [--sonar-key <k>] [--sonar-org <o>] [--sonar-host <url>]",
    "                                                         [--no-git] [--gh-create] [--gh-public] [--gh-owner <user>]",
    "                                                         [--no-interactive] [--json]",
    "    beerengineer workspace list [--json]                 List registered workspaces",
    "    beerengineer workspace get <key> [--json]            Get one workspace",
    "    beerengineer workspace items <key> [--json]          List items for one workspace",
    "    beerengineer workspace use <key>                     Select the current workspace",
    "    beerengineer workspace remove <key> [--purge] [--yes]",
    "                                                         Unregister a workspace (--purge also rm -rf's root; --yes skips confirm)",
    "    beerengineer workspace open <key>                    Print the workspace root path",
    "    beerengineer workspace backfill [--json]             Write missing .beerengineer/workspace.json files",
    "    beerengineer workspace gc-worktrees <key> [--json]   Remove orphaned beerengineer_ story worktrees",
    "    beerengineer projects [--json]                       Alias for workspace list",
    "    beerengineer project get <key> [--json]              Alias for workspace get",
    "    beerengineer item get <id|code> [--workspace <key>]  Show one item",
    "    beerengineer item open <id|code> [--workspace <key>] Open one item in the UI",
    "    beerengineer item preview <id|code> [--start|--stop] [--open] [--workspace <key>] [--json]",
    "                                                         Show or start the item-branch local preview",
    "    beerengineer item wireframes <id|code> [--open] [--workspace <key>] [--json]",
    "                                                         Show/open wireframe artifacts",
    "    beerengineer item design <id|code> [--open] [--workspace <key>] [--json]",
    "                                                         Show/open design artifact",
    "    beerengineer item import-prepared <id|code> --from <dir> [--json]",
    "                                                         Import prepared concept/PRDs and start implementation",
    "    beerengineer run list [--all] [--compact]            List runs",
    "    beerengineer run get <run-id> [--json]               Show one run",
    "    beerengineer runs messages <run-id> [--level L2]    Show canonical message history",
    "                                                         Flags: [--since <id>] [--limit N] [--json]",
    "    beerengineer runs tail <run-id> [--level L1]        Tail canonical message stream",
    "                                                         Flags: [--since <id>] [--json]",
    "    beerengineer runs watch <run-id> [--level L1]       Replay history, then tail live",
    "                                                         Flags: [--since <id>] [--json]",
    "    beerengineer run open <run-id>                       Open one run in the UI",
    "    beerengineer chat list [--all] [--compact]           List open prompts",
    "    beerengineer chat send <run-id> <text>              Send a free-form user message",
    "    beerengineer chat answer (--prompt <id>|--run <id>)  Answer a prompt",
    "    beerengineer chat answer <run-id> <text>             Positional shortcut for the active prompt",
    "    beerengineer --help                                  Show this help",
    "",
    "  Item actions:",
    "    start_brainstorm  start_visual_companion  start_frontend_design",
    "    promote_to_requirements  start_implementation  import_prepared",
    "    rerun_design_prep",
    "    promote_to_base  cancel_promotion  resume_run  mark_done",
    "",
    "  Resume flags (for --action resume_run on a blocked run):",
    "    --remediation-summary <text>   Required. What you fixed outside beerengineer_.",
    "    --branch <name>                Optional. Branch that holds the fix.",
    "    --commit <sha>                 Optional. Fix commit SHA.",
    "    --notes <text>                 Optional. Extra review notes.",
    "    --yes                          Skip the interactive prompt when on a TTY.",
    "",
    "  Message levels:",
    "    L2  milestones only",
    "    L1  milestones plus operational detail",
    "    L0  full debug stream",
    "",
    "  Workflow behavior:",
    "    User prompts are limited to intake and blocked-run recovery.",
    "    Stage-internal LLM/reviewer interaction still happens, but stages from",
    "    architecture through documentation run without user chat unless a blocker stops the run.",
    "    Items with UI additionally run two item-scoped stages — visual-companion",
    "    and frontend-design — between brainstorm and requirements. Both are",
    "    silently skipped when item-level hasUi === false.",
    "    After project handoff, items stop in merge-gate before landing on the",
    "    base branch. Managed previews use a per-worktree port from",
    "    BEERENGINEER_WORKTREE_PORT_POOL.",
    "",
    "  Aliases:",
    "    -h  --help  --doctor  projects  project get  items  chats  runs",
    "",
    "  Quick start:",
    "    beerengineer workspace list",
    "    beerengineer workspace use <key>",
    "    beerengineer status",
    "    beerengineer items",
    "    beerengineer chats",
    "",
    "  Setup groups:",
    `    ${KNOWN_GROUP_IDS.join("  ")}`,
    "",
  ]
  console.log(lines.join("\n"))
}

export function validateGroup(group: string | undefined): number | null {
  if (group && !isKnownGroupId(group)) {
    console.error(`  Unknown setup group: ${group}`)
    return 2
  }
  return null
}
