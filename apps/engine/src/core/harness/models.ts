import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { HarnessRole, KnownHarness } from "../../types/workspace.js"

export type ProviderModels = {
  provider: string
  models: Array<{
    id: string
    aliases?: string[]
    default?: { role: HarnessRole }
  }>
}

export type HarnessPresetRole = {
  harness: KnownHarness
  provider: string
  model: string
}

export type HarnessPreset = {
  coder: HarnessPresetRole
  reviewer: HarnessPresetRole
}

type PresetsFile = {
  schemaVersion: 1
  default: string
  providers: Array<{ name: string; models: ProviderModels["models"] }>
  presets: Record<string, HarnessPreset>
}

const here = dirname(fileURLToPath(import.meta.url))
const PRESETS_FILE = JSON.parse(readFileSync(resolve(here, "presets.json"), "utf8")) as PresetsFile

export const PROVIDER_MODELS: ProviderModels[] = PRESETS_FILE.providers.map(entry => ({
  provider: entry.name,
  models: entry.models,
}))

export const DEFAULT_HARNESS_MODELS: Record<string, HarnessPreset> = PRESETS_FILE.presets
export const DEFAULT_PRESET_MODE: string = PRESETS_FILE.default
export const KNOWN_PRESET_MODES: string[] = Object.keys(PRESETS_FILE.presets)

export function isKnownModel(provider: string, model: string): boolean {
  const known = PROVIDER_MODELS.find(entry => entry.provider === provider)
  if (!known) return false
  return known.models.some(candidate => candidate.id === model || candidate.aliases?.includes(model))
}

export function isKnownPresetMode(mode: string): boolean {
  return Object.hasOwn(PRESETS_FILE.presets, mode)
}

export function getPreset(mode: string): HarnessPreset | undefined {
  return PRESETS_FILE.presets[mode]
}
