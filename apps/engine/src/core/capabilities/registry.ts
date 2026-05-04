import { isCapabilityId, type CapabilityDefinition, type CapabilityId } from "./types.js"

export type CapabilityRegistry<Definitions extends readonly CapabilityDefinition[]> = {
  [Definition in Definitions[number] as Definition["id"]]: CapabilityDefinition<Definition["id"]>
}

export function defineCapabilities<const Definitions extends readonly CapabilityDefinition[]>(
  definitions: Definitions,
): CapabilityRegistry<Definitions> {
  const registry: Partial<Record<CapabilityId, CapabilityDefinition>> = {}

  for (const definition of definitions) {
    if (!isCapabilityId(definition.id)) {
      throw new Error(`Unknown capability ID: ${String(definition.id)}`)
    }
    if (registry[definition.id]) {
      throw new Error(`Duplicate capability ID: ${definition.id}`)
    }
    registry[definition.id] = definition
  }

  return registry as CapabilityRegistry<Definitions>
}
