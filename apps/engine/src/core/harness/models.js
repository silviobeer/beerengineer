import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const PRESETS_FILE = JSON.parse(readFileSync(resolve(here, "presets.json"), "utf8"));
export const PROVIDER_MODELS = PRESETS_FILE.providers.map(entry => ({
    provider: entry.name,
    models: entry.models,
}));
export const DEFAULT_HARNESS_MODELS = PRESETS_FILE.presets;
export const DEFAULT_PRESET_MODE = PRESETS_FILE.default;
export const KNOWN_PRESET_MODES = Object.keys(PRESETS_FILE.presets);
export function isKnownModel(provider, model) {
    const known = PROVIDER_MODELS.find(entry => entry.provider === provider);
    if (!known)
        return false;
    return known.models.some(candidate => candidate.id === model || candidate.aliases?.includes(model));
}
export function isKnownPresetMode(mode) {
    return Object.hasOwn(PRESETS_FILE.presets, mode);
}
export function getPreset(mode) {
    return PRESETS_FILE.presets[mode];
}
