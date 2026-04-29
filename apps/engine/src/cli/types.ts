import type { MessagingLevel } from "../core/messagingLevel.js"

export type ResumeFlags = {
  summary?: string
  branch?: string
  commit?: string
  notes?: string
  yes?: boolean
}

export type Command =
  | { kind: "help" }
  | { kind: "start-engine" }
  | { kind: "doctor"; json?: boolean; group?: string }
  | { kind: "setup"; group?: string; noInteractive?: boolean }
  | {
      kind: "update"
      check?: boolean
      json?: boolean
      dryRun?: boolean
      rollback?: boolean
      version?: string
      allowLegacyDbShadow?: boolean
    }
  | { kind: "notifications-test"; channel: "telegram" }
  | { kind: "start-ui" }
  | { kind: "workflow"; json?: boolean; workspaceKey?: string; verbose?: boolean }
  | { kind: "item-action"; itemRef: string; action: string; resume?: ResumeFlags }
  | { kind: "item-import-prepared"; itemRef?: string; sourceDir?: string; workspaceKey?: string; json?: boolean }
  | { kind: "workspace-preview"; path?: string; json?: boolean }
  | {
      kind: "workspace-add"
      json?: boolean
      noInteractive?: boolean
      path?: string
      name?: string
      key?: string
      profile?: string
      profileJson?: string
      sonar?: boolean
      sonarKey?: string
      sonarOrg?: string
      sonarHost?: string
      sonarToken?: string
      sonarTokenPersist?: boolean
      noGit?: boolean
      ghCreate?: boolean
      ghPublic?: boolean
      ghOwner?: string
    }
  | { kind: "workspace-list"; json?: boolean }
  | { kind: "workspace-get"; key?: string; json?: boolean }
  | { kind: "workspace-items"; key?: string; json?: boolean }
  | { kind: "workspace-use"; key?: string }
  | { kind: "workspace-remove"; key?: string; json?: boolean; purge?: boolean; yes?: boolean; noInteractive?: boolean }
  | { kind: "workspace-open"; key?: string }
  | { kind: "workspace-backfill"; json?: boolean }
  | { kind: "workspace-worktree-gc"; key?: string; json?: boolean }
  | { kind: "status"; workspaceKey?: string; json?: boolean; all?: boolean }
  | { kind: "chat-list"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "chat-send"; runId?: string; text?: string; json?: boolean }
  | { kind: "chat-answer"; promptId?: string; runId?: string; answer?: string; multiline?: boolean; editor?: boolean; json?: boolean }
  | { kind: "items"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "chats"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "runs"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "item-get"; itemRef?: string; workspaceKey?: string; json?: boolean }
  | { kind: "item-open"; itemRef?: string; workspaceKey?: string }
  | { kind: "item-preview"; itemRef?: string; workspaceKey?: string; start?: boolean; stop?: boolean; open?: boolean; json?: boolean }
  | { kind: "item-wireframes"; itemRef?: string; workspaceKey?: string; open?: boolean; json?: boolean }
  | { kind: "item-design"; itemRef?: string; workspaceKey?: string; open?: boolean; json?: boolean }
  | { kind: "run-list"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "run-get"; runId?: string; json?: boolean }
  | { kind: "run-open"; runId?: string }
  | { kind: "run-tail"; runId?: string; level: MessagingLevel; since?: string; json?: boolean }
  | { kind: "run-messages"; runId?: string; level: MessagingLevel; since?: string; limit: number; json?: boolean }
  | { kind: "run-watch"; runId?: string; level: MessagingLevel; since?: string; json?: boolean }
  | { kind: "unknown"; token: string }
