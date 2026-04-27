import type {
  Amendment,
  Concept,
  DesignArtifact,
  Navigation,
  NavigationFlow,
  WireframeArtifact,
} from "../types/domain.js"
import type { DesignGuidance } from "../types/execution.js"

function mergeConceptText(base: string, amendments: Amendment[]): string {
  if (amendments.length === 0) return base
  const lines = amendments.map(amendment => `- ${amendment.description}`)
  return [base, "", "Design prep amendments:", ...lines].join("\n")
}

function filterFlows(flows: NavigationFlow[], projectId: string, screenIds: Set<string>): NavigationFlow[] {
  return flows.filter(
    flow =>
      flow.projectIds.includes(projectId) &&
      screenIds.has(flow.from) &&
      screenIds.has(flow.to),
  )
}

function filterNavForProject(navigation: Navigation, projectId: string, screenIds: Set<string>): Navigation {
  return {
    entryPoints: navigation.entryPoints.filter(
      entry => entry.projectId === projectId && screenIds.has(entry.screenId),
    ),
    flows: filterFlows(navigation.flows, projectId, screenIds),
  }
}

export function projectWireframes(
  artifact: WireframeArtifact,
  projectId: string,
): WireframeArtifact {
  const screens = artifact.screens.filter(screen => screen.projectIds.includes(projectId))
  const screenIds = new Set(screens.map(screen => screen.id))
  // Strip the inline wireframe HTML before passing the artifact downstream —
  // requirements/architecture/planning/execution stages need the structural
  // info (regions, navigation, screens) but not the rendered HTML, which can
  // easily inflate the prompt by 30-50KB per screen.
  const { wireframeHtmlPerScreen: _omit, ...rest } = artifact
  void _omit
  return {
    ...rest,
    screens,
    navigation: filterNavForProject(artifact.navigation, projectId, screenIds),
    conceptAmendments: artifact.conceptAmendments?.filter(
      amendment => amendment.projectId === undefined || amendment.projectId === projectId,
    ),
  }
}

// Design tokens are item-wide by contract — no per-project filtering exists
// or is planned. Kept as a named function so call sites stay symmetric with
// projectWireframes() and so a future scoping change has a single touch point.
// Strips mockupHtmlPerScreen so downstream stages do not haul the full
// hi-fi mockup HTML (often 25KB per screen) through their prompt payload.
export function projectDesign(artifact: DesignArtifact): DesignArtifact {
  const { mockupHtmlPerScreen: _omit, ...rest } = artifact
  void _omit
  return rest
}

export function projectDesignGuidance(artifact: DesignArtifact | undefined): DesignGuidance | undefined {
  if (!artifact) return undefined
  return {
    tone: artifact.tone,
    antiPatterns: artifact.antiPatterns,
  }
}

export function mergeAmendments(
  concept: Concept,
  amendments: Amendment[] | undefined,
  projectId?: string,
): Concept {
  const relevant = (amendments ?? []).filter(
    amendment => amendment.projectId === undefined || amendment.projectId === projectId,
  )
  if (relevant.length === 0) return concept
  return {
    ...concept,
    summary: mergeConceptText(concept.summary, relevant),
    constraints: [...(Array.isArray(concept.constraints) ? concept.constraints : []), ...relevant.map(amendment => amendment.description)],
  }
}
