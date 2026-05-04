import { resolve } from "node:path"
import type { SonarConfig } from "../../types/workspace.js"
import {
  SONAR_PROPERTIES_FILE,
  SONAR_WORKFLOW_FILE,
  renderSonarWorkflow,
  writeFileIfMissing,
} from "../workspaces/shared.js"
import {
  provisionSonarProject,
  runWorkspacePreflight,
  writeSonarProperties,
} from "../workspaces/sonar.js"
import type { WorkspaceCapabilityContext } from "./workspaceContext.js"

export async function provisionWorkspaceSonarCapability(
  context: WorkspaceCapabilityContext,
  name: string,
  sonar: SonarConfig,
  actions: string[],
  warnings: string[],
) {
  const { workspaceRoot, github } = context
  if (!(github.ready && github.owner && github.repo && sonar.enabled)) {
    return await runWorkspacePreflight(workspaceRoot, { sonarHostUrl: sonar.hostUrl, sonarEnabled: sonar.enabled })
  }
  const sonarWrite = await writeSonarProperties(workspaceRoot, github.owner, github.repo)
  if (sonarWrite.changed) actions.push(`wrote ${SONAR_PROPERTIES_FILE}`)
  warnings.push(...sonarWrite.warnings)
  if (await writeFileIfMissing(resolve(workspaceRoot, SONAR_WORKFLOW_FILE), renderSonarWorkflow())) actions.push(`wrote ${SONAR_WORKFLOW_FILE}`)
  const refreshedPreflight = await runWorkspacePreflight(workspaceRoot, { sonarHostUrl: sonar.hostUrl, sonarEnabled: sonar.enabled })
  if (sonar.enabled && refreshedPreflight.report.sonar.status === "ok") {
    await provisionSonarProject(workspaceRoot, name, sonar, actions, warnings)
  }
  return refreshedPreflight
}
