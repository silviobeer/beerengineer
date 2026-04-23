import Database from "better-sqlite3"
import { resolve } from "node:path"
import { homedir } from "node:os"

function resolveDbPath(): string {
  return process.env.BEERENGINEER_UI_DB_PATH ?? resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")
}

function isGenericPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return true
  return /^\s*you\s*>\s*$/i.test(prompt)
}

export function resolvePromptDisplayText(runId: string, prompt: string): string {
  if (!isGenericPrompt(prompt)) return prompt
  let db: Database.Database | null = null
  try {
    db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true })
    const row = db
      .prepare(
        `select message
           from stage_logs
          where run_id = ?
            and event_type = 'chat_message'
            and trim(message) <> ''
          order by created_at desc, rowid desc
          limit 1`
      )
      .get(runId) as { message?: string } | undefined
    return row?.message?.trim() ? row.message : prompt
  } catch {
    return prompt
  } finally {
    db?.close()
  }
}
