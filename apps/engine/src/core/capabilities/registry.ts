import { isCapabilityId, preflightNotConfigured, type CapabilityDefinition, type CapabilityId } from "./types.js"
import { supabaseCapability } from "./supabaseCapability.js"

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

export const gitCapabilityDefinition: CapabilityDefinition<"git"> = {
  id: "git",
  ports: {
    availability: () => ({ capabilityId: "git", available: true, reason: "configured" }),
  },
}

export const githubCapabilityDefinition: CapabilityDefinition<"github"> = {
  id: "github",
  ports: {
    availability: () => ({ capabilityId: "github", available: false, reason: "not configured" }),
    preflight: () => preflightNotConfigured("github", "gh auth login required"),
  },
}

export const sonarCapabilityDefinition: CapabilityDefinition<"sonar"> = {
  id: "sonar",
  ports: {
    availability: () => ({ capabilityId: "sonar", available: false, reason: "not configured" }),
    preflight: () => preflightNotConfigured("sonar", "SONAR_TOKEN is missing"),
  },
}

export const coderabbitCapabilityDefinition: CapabilityDefinition<"coderabbit"> = {
  id: "coderabbit",
  ports: {
    availability: () => ({ capabilityId: "coderabbit", available: false, reason: "not configured" }),
    preflight: () => preflightNotConfigured("coderabbit", "coderabbit CLI is not configured"),
  },
}

export const CAPABILITY_REGISTRY = defineCapabilities([
  gitCapabilityDefinition,
  githubCapabilityDefinition,
  sonarCapabilityDefinition,
  coderabbitCapabilityDefinition,
  supabaseCapability,
] as const)

export function getCapability<Id extends CapabilityId>(id: Id): CapabilityDefinition<Id> {
  return CAPABILITY_REGISTRY[id] as CapabilityDefinition<Id>
}
