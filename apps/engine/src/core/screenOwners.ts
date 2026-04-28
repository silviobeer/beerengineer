import type { ImplementationPlanArtifact, PRD, WireframeArtifact } from "../types.js"

export type ScreenOwnerMap = Record<string, string>

export function computeScreenOwners(
  _prd: PRD,
  plan: ImplementationPlanArtifact,
  wireframes: WireframeArtifact | undefined,
): ScreenOwnerMap {
  if (!wireframes || wireframes.screens.length === 0) return {}

  const validScreens = new Set(wireframes.screens.map(screen => screen.id))
  const owners: ScreenOwnerMap = {}
  for (const wave of plan.plan.waves) {
    if (wave.kind === "setup") continue
    for (const story of wave.stories) {
      for (const screenId of story.screenIds ?? []) {
        if (!validScreens.has(screenId) || owners[screenId]) continue
        owners[screenId] = story.id
      }
    }
  }
  return owners
}
