import type { IncomingMessage, ServerResponse } from "node:http"
import { initializeAppState } from "../../setup/appState.js"
import { getAppConfigView } from "../../setup/appConfigView.js"
import { patchAppConfig } from "../../setup/appConfigPatch.js"
import { generateSetupReport, runSetupRecheck } from "../../setup/doctor.js"
import { applySecretAction } from "../../setup/secretActions.js"
import { readSecretMetadata } from "../../setup/secretMetadata.js"
import { runSecretTest } from "../../setup/secretTests.js"
import { KNOWN_GROUP_IDS } from "../../setup/config.js"
import { json, readJson } from "../http.js"

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

export async function handleSetupConfigPatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req)
  const result = patchAppConfig({}, body)
  json(res, result.rejected.length > 0 ? 207 : 200, result)
}

export async function handleSetupRecheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req)
  const group = body && typeof body === "object" && typeof (body as { group?: unknown }).group === "string"
    ? (body as { group: string }).group
    : undefined
  const result = await runSetupRecheck({ group })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSecretAction(req: IncomingMessage, res: ServerResponse, ref: string): Promise<void> {
  const body = await readJson(req)
  const decoded = parseSecretRef(ref)
  if (!decoded) {
    json(res, 400, { error: "invalid_secret_ref" })
    return
  }
  if (body && typeof body === "object" && (body as { action?: unknown }).action === "test") {
    const result = await runSecretTest(decoded)
    json(res, result.ok ? 200 : result.status === "not_implemented" ? 501 : 409, result)
    return
  }
  const result = applySecretAction(decoded, body)
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSecretMetadata(res: ServerResponse, ref: string): Promise<void> {
  const decoded = parseSecretRef(ref)
  if (!decoded) {
    json(res, 400, { error: "invalid_secret_ref" })
    return
  }
  json(res, 200, readSecretMetadata(decoded))
}

function parseSecretRef(raw: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const trimmed = decoded.trim()
  if (!trimmed || trimmed.includes("\0")) return null
  return trimmed
}
