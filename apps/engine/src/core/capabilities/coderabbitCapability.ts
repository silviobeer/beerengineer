import { resolve } from "node:path"
import { CODERABBIT_CONFIG_FILE, renderCoderabbitConfig, writeFileIfMissing } from "../workspaces/shared.js"

export async function provisionWorkspaceCodeRabbitCapability(workspaceRoot: string, actions: string[]): Promise<void> {
  if (await writeFileIfMissing(resolve(workspaceRoot, CODERABBIT_CONFIG_FILE), renderCoderabbitConfig())) actions.push(`wrote ${CODERABBIT_CONFIG_FILE}`)
}
