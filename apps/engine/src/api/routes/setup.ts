import type { ServerResponse } from "node:http"
import { initializeAppState } from "../../setup/appState.js"
import { getAppConfigView } from "../../setup/appConfigView.js"
import { generateSetupReport } from "../../setup/doctor.js"
import { KNOWN_GROUP_IDS } from "../../setup/config.js"
import { json } from "../http.js"

export async function handleSetupStatus(url: URL, res: ServerResponse): Promise<void> {
  const group = url.searchParams.get("group") ?? undefined
  if (group && !(KNOWN_GROUP_IDS as readonly string[]).includes(group)) {
    json(res, 400, { error: "unknown_group", group })
    return
  }
  const report = await generateSetupReport({ group })
  json(res, 200, report)
}

export async function handleSetupInit(res: ServerResponse): Promise<void> {
  const result = initializeAppState()
  json(res, result.ok ? 200 : 409, result)
}

export async function handleSetupConfig(res: ServerResponse): Promise<void> {
  json(res, 200, getAppConfigView())
}
