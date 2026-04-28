import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export class PromptLoadError extends Error {
    kind;
    id;
    path;
    missing;
    source;
    constructor(message, kind, id, path, missing, source = "prompt") {
        super(message);
        this.kind = kind;
        this.id = id;
        this.path = path;
        this.missing = missing;
        this.source = source;
        this.name = "PromptLoadError";
    }
}
const cache = new Map();
function promptsRoot() {
    const override = process.env.BEERENGINEER_PROMPTS_DIR?.trim();
    if (override) {
        return isAbsolute(override) ? override : resolve(process.cwd(), override);
    }
    // Assumes tsx-style execution with source layout src/llm/prompts/loader.ts;
    // if a build step ever flattens output, override via BEERENGINEER_PROMPTS_DIR.
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "../../..", "prompts");
}
function stripLeadingHeading(text) {
    return text.replace(/^# .*\r?\n(?:\r?\n)?/, "");
}
function promptPath(kind, id) {
    return resolve(promptsRoot(), kind, `${id}.md`);
}
function bundlePath(id) {
    if (!/^[a-z0-9][a-z0-9/-]*$/i.test(id) || id.includes("//")) {
        throw new PromptLoadError(`Invalid prompt bundle id "${id}".`, "system", id, id, false, "bundle");
    }
    const root = resolve(promptsRoot(), "references");
    const path = resolve(root, `${id}.md`);
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new PromptLoadError(`Prompt bundle id "${id}" resolves outside the references directory.`, "system", id, path, false, "bundle");
    }
    return path;
}
function readPromptFile(kind, id) {
    const path = promptPath(kind, id);
    try {
        return stripLeadingHeading(readFileSync(path, "utf8"));
    }
    catch (error) {
        const envOverride = process.env.BEERENGINEER_PROMPTS_DIR?.trim();
        const details = error instanceof Error ? error.message : String(error);
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
        throw new PromptLoadError(`Failed to load prompt kind="${kind}" id="${id}" from "${path}". ` +
            `BEERENGINEER_PROMPTS_DIR=${envOverride ? JSON.stringify(envOverride) : "unset"}. ` +
            details, kind, id, path, missing, "prompt");
    }
}
function readBundleFile(kind, id) {
    const path = bundlePath(id);
    try {
        return stripLeadingHeading(readFileSync(path, "utf8"));
    }
    catch (error) {
        const envOverride = process.env.BEERENGINEER_PROMPTS_DIR?.trim();
        const details = error instanceof Error ? error.message : String(error);
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
        throw new PromptLoadError(`Failed to load prompt bundle id="${id}" from "${path}". ` +
            `BEERENGINEER_PROMPTS_DIR=${envOverride ? JSON.stringify(envOverride) : "unset"}. ` +
            details, kind, id, path, missing, "bundle");
    }
}
function normalizeBundleIds(bundleIds) {
    const seen = new Set();
    for (const bundleId of bundleIds) {
        if (seen.has(bundleId)) {
            throw new PromptLoadError(`Duplicate prompt bundle id "${bundleId}".`, "system", bundleId, bundleId, false, "bundle");
        }
        seen.add(bundleId);
    }
    return [...bundleIds].sort((left, right) => left.localeCompare(right));
}
export function loadPrompt(kind, id) {
    const cacheKey = `${kind}/${id}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    const prompt = readPromptFile(kind, id);
    cache.set(cacheKey, prompt);
    return prompt;
}
export function loadComposedPrompt(kind, id, bundleIds = []) {
    const normalizedBundleIds = normalizeBundleIds(bundleIds);
    if (normalizedBundleIds.length === 0)
        return loadPrompt(kind, id);
    const cacheKey = `${kind}/${id}::${normalizedBundleIds.join(",")}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    const prompt = loadPrompt(kind, id);
    const references = normalizedBundleIds.map((bundleId) => readBundleFile(kind, bundleId).trimEnd()).join("\n\n");
    const composed = `${prompt.trimEnd()}\n\n## References\n\n${references}\n`;
    cache.set(cacheKey, composed);
    return composed;
}
export function clearPromptCache() {
    cache.clear();
}
