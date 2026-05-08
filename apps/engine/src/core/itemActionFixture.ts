import { ITEM_ACTION_MATRIX, ITEM_ACTIONS, type ItemAction } from "./itemActions.js"

const PHASES = ["draft", "running", "review_required", "completed", "failed"] as const

export type AllowedItemActionsByState = Record<string, ItemAction[]>

function compareAlphabetically(left: string, right: string): number {
  return left.localeCompare(right)
}

function expandStateKey(key: string): string[] {
  const [column, phase] = key.split("/")
  if (!column || !phase) throw new Error(`Invalid item action matrix key: ${key}`)
  if (phase !== "*") return [`${column}/${phase}`]
  return PHASES.map(candidate => `${column}/${candidate}`)
}

export function buildAllowedItemActionsByState(): AllowedItemActionsByState {
  const byState = new Map<string, Set<ItemAction>>()

  for (const action of ITEM_ACTIONS) {
    for (const key of Object.keys(ITEM_ACTION_MATRIX[action])) {
      for (const expandedKey of expandStateKey(key)) {
        if (!byState.has(expandedKey)) byState.set(expandedKey, new Set<ItemAction>())
        byState.get(expandedKey)!.add(action)
      }
    }
  }

  return Object.fromEntries(
    [...byState.entries()]
      .sort(([left], [right]) => compareAlphabetically(left, right))
      .map(([key, actions]) => [key, ITEM_ACTIONS.filter(action => actions.has(action))]),
  )
}

export function serializeAllowedItemActionsByState(value: AllowedItemActionsByState): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function formatActions(actions: readonly string[] | undefined): string {
  return actions && actions.length > 0 ? actions.join(", ") : "none"
}

export function diffAllowedItemActionsByState(
  committed: AllowedItemActionsByState,
  generated: AllowedItemActionsByState,
): string | null {
  const keys = new Set([...Object.keys(committed), ...Object.keys(generated)])
  for (const key of [...keys].sort(compareAlphabetically)) {
    const committedActions = committed[key] ?? []
    const generatedActions = generated[key] ?? []
    if (JSON.stringify(committedActions) === JSON.stringify(generatedActions)) continue
    return [
      "Committed allowed-actions fixture is stale relative to generated engine-side action data.",
      "Source: engine transition rules.",
      `State: ${key}.`,
      `Committed: ${formatActions(committedActions)}.`,
      `Generated: ${formatActions(generatedActions)}.`,
    ].join(" ")
  }
  return null
}
