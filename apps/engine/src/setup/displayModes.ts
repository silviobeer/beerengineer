export const SETUP_DISPLAY_MODES = ["ready", "action-required", "informational"] as const

export type SetupDisplayMode = (typeof SETUP_DISPLAY_MODES)[number]

export type SetupDisplayFreshness = {
  strategy: "per_request"
  invalidatedBy: string[]
}

export type SetupDisplayFact = {
  mode: SetupDisplayMode
  detail: string
  freshness: SetupDisplayFreshness
}

export function createSetupDisplayFact(
  mode: SetupDisplayMode,
  detail: string,
  invalidatedBy: string[],
): SetupDisplayFact {
  return {
    mode,
    detail,
    freshness: {
      strategy: "per_request",
      invalidatedBy: [...invalidatedBy],
    },
  }
}
