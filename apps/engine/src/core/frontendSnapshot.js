import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const MAX_FILE_BYTES = 32 * 1024;
const TREE_DEPTH = 3;
const TREE_MAX_ENTRIES = 200;
// Files probed inside each detected frontend root. Existence is checked one
// by one; missing files are silently skipped. Each entry's content is bounded.
const FRONTEND_CONFIG_PATHS = [
    // Tailwind
    "tailwind.config.ts",
    "tailwind.config.js",
    "tailwind.config.mjs",
    "tailwind.config.cjs",
    // PostCSS
    "postcss.config.ts",
    "postcss.config.js",
    "postcss.config.mjs",
    "postcss.config.cjs",
    // Bundlers / framework configs
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    // Global stylesheets — App Router and common conventions
    "app/globals.css",
    "src/app/globals.css",
    "styles/globals.css",
    // Root layouts (Next.js App Router)
    "app/layout.tsx",
    "app/layout.jsx",
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    // Theme / token modules
    "theme.ts",
    "theme.js",
    "tokens.ts",
    "tokens.js",
    "design-tokens.css",
];
// Directories walked for the shallow component / route inventory.
const FRONTEND_TREE_DIRS = [
    "components",
    "src/components",
    "app",
    "src/app",
    "pages",
    "src/pages",
];
const SKIP_DIRS = new Set([
    ".git",
    "node_modules",
    ".next",
    ".turbo",
    ".bg-shell",
    ".beerengineer",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".vscode",
]);
function readBoundedFile(path) {
    try {
        const raw = readFileSync(path, "utf8");
        if (raw.length <= MAX_FILE_BYTES)
            return raw;
        return raw.slice(0, MAX_FILE_BYTES) + `\n\n…[truncated, original ${raw.length} bytes]`;
    }
    catch {
        return undefined;
    }
}
function detectFromDeps(deps) {
    if (!deps)
        return {};
    // Order matters: a Next.js project always also declares `react`; we want the
    // higher-level framework first.
    const has = (name) => Object.hasOwn(deps, name);
    let framework;
    if (has("next"))
        framework = "next";
    else if (has("@angular/core"))
        framework = "angular";
    else if (has("vue"))
        framework = "vue";
    else if (has("svelte") || has("@sveltejs/kit"))
        framework = "svelte";
    else if (has("react"))
        framework = "react";
    let stylingSystem;
    if (has("tailwindcss"))
        stylingSystem = "tailwind";
    else if (has("styled-components"))
        stylingSystem = "styled-components";
    else if (has("@emotion/react") || has("@emotion/styled"))
        stylingSystem = "emotion";
    return { framework, stylingSystem };
}
function readPackageDeps(pkgJsonPath) {
    try {
        const raw = readFileSync(pkgJsonPath, "utf8");
        const parsed = JSON.parse(raw);
        const dependencies = parsed.dependencies ?? undefined;
        const devDependencies = parsed.devDependencies ?? undefined;
        if (dependencies && devDependencies)
            return { ...dependencies, ...devDependencies };
        return dependencies ?? devDependencies;
    }
    catch {
        return undefined;
    }
}
function appendDetectedFrontendRoots(workspaceRoot, parent, roots) {
    const parentAbs = join(workspaceRoot, parent);
    let entries;
    try {
        if (!statSync(parentAbs).isDirectory())
            return;
        entries = readdirSync(parentAbs);
    }
    catch {
        return;
    }
    for (const name of entries) {
        const subAbs = join(parentAbs, name);
        try {
            if (!statSync(subAbs).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const subDeps = readPackageDeps(join(subAbs, "package.json"));
        if (detectFromDeps(subDeps).framework) {
            roots.push(`${parent}/${name}`);
        }
    }
}
/**
 * Detect candidate frontend roots: workspace root if it has frontend deps,
 * plus any direct subdir of `apps/` whose package.json declares one. Common
 * non-monorepo projects yield exactly one root (""); the user's own
 * monorepo (apps/ui, apps/engine) yields ["", "apps/ui"] when ui has
 * frontend deps and the root inherits via workspaces.
 */
function detectFrontendRoots(workspaceRoot) {
    const roots = [];
    const rootDeps = readPackageDeps(join(workspaceRoot, "package.json"));
    const rootDetect = detectFromDeps(rootDeps);
    if (rootDetect.framework)
        roots.push("");
    // Probe direct children of apps/, frontend/, web/, packages/ (the common
    // monorepo shapes) for nested package.json files declaring FE deps.
    const monorepoParents = ["apps", "packages"];
    for (const parent of monorepoParents) {
        appendDetectedFrontendRoots(workspaceRoot, parent, roots);
    }
    // Also probe non-monorepo conventions if root didn't match.
    if (roots.length === 0) {
        for (const sub of ["frontend", "web"]) {
            const subDeps = readPackageDeps(join(workspaceRoot, sub, "package.json"));
            if (detectFromDeps(subDeps).framework)
                roots.push(sub);
        }
    }
    return roots;
}
function walkShallow(root, current, depth, out) {
    if (depth < 0 || out.length >= TREE_MAX_ENTRIES)
        return;
    let entries;
    try {
        entries = readdirSync(current).sort((left, right) => left.localeCompare(right));
    }
    catch {
        return;
    }
    for (const name of entries) {
        if (out.length >= TREE_MAX_ENTRIES)
            return;
        if (SKIP_DIRS.has(name) || name.startsWith("."))
            continue;
        const full = join(current, name);
        let isDir;
        try {
            isDir = statSync(full).isDirectory();
        }
        catch {
            continue;
        }
        const rel = relative(root, full) || name;
        out.push(isDir ? `${rel}/` : rel);
        if (isDir)
            walkShallow(root, full, depth - 1, out);
    }
}
/**
 * Capture a brownfield frontend fingerprint so design-prep stages
 * (visual-companion / frontend-design) can design a screen that fits the
 * project's existing visual language instead of inventing one. Cheap when
 * nothing matches: every probe fails silently and the result has empty
 * arrays, which the agent reads as "greenfield".
 *
 * Caller is responsible for gating on `hasUi` — see workflow.ts.
 */
export function loadFrontendSnapshot(workspaceRoot) {
    if (!workspaceRoot || !existsSync(workspaceRoot))
        return undefined;
    const detectedRoots = detectFrontendRoots(workspaceRoot);
    if (detectedRoots.length === 0)
        return undefined;
    const { framework, stylingSystem } = detectFrontendMetadata(workspaceRoot, detectedRoots);
    const configFiles = collectFrontendConfigFiles(workspaceRoot, detectedRoots);
    const componentTree = collectFrontendComponentTree(workspaceRoot, detectedRoots);
    return { detectedRoots, framework, stylingSystem, configFiles, componentTree };
}
function detectFrontendMetadata(workspaceRoot, detectedRoots) {
    let framework;
    let stylingSystem;
    for (const rel of detectedRoots) {
        const deps = readPackageDeps(join(workspaceRoot, rel, "package.json"));
        const detected = detectFromDeps(deps);
        if (!framework)
            framework = detected.framework;
        if (!stylingSystem)
            stylingSystem = detected.stylingSystem;
    }
    if (!stylingSystem && hasCssModuleStyling(workspaceRoot, detectedRoots)) {
        stylingSystem = "css-modules";
    }
    return { framework, stylingSystem };
}
function hasCssModuleStyling(workspaceRoot, detectedRoots) {
    if (detectedRoots.length === 0)
        return false;
    const firstRoot = join(workspaceRoot, detectedRoots[0]);
    return anyCssModule(firstRoot);
}
function collectFrontendConfigFiles(workspaceRoot, detectedRoots) {
    const configFiles = [];
    for (const rel of detectedRoots) {
        appendFrontendConfigFiles(workspaceRoot, rel, configFiles);
    }
    return configFiles;
}
function appendFrontendConfigFiles(workspaceRoot, rel, configFiles) {
    for (const file of FRONTEND_CONFIG_PATHS) {
        const probed = rel === "" ? file : `${rel}/${file}`;
        const content = readBoundedFile(join(workspaceRoot, probed));
        if (content !== undefined)
            configFiles.push({ path: probed, content });
    }
}
function collectFrontendComponentTree(workspaceRoot, detectedRoots) {
    const componentTree = [];
    for (const rel of detectedRoots) {
        appendFrontendComponentTree(workspaceRoot, rel, componentTree);
    }
    return componentTree;
}
function appendFrontendComponentTree(workspaceRoot, rel, componentTree) {
    for (const dir of FRONTEND_TREE_DIRS) {
        const probed = rel === "" ? dir : `${rel}/${dir}`;
        const dirAbs = join(workspaceRoot, probed);
        try {
            if (!statSync(dirAbs).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        // Header so the agent can tell which tree each entry belongs to.
        componentTree.push(`${probed}/`);
        walkShallow(workspaceRoot, dirAbs, TREE_DEPTH - 1, componentTree);
    }
}
function anyCssModule(rootAbs, depth = 3) {
    let entries;
    try {
        entries = readdirSync(rootAbs);
    }
    catch {
        return false;
    }
    for (const name of entries) {
        if (SKIP_DIRS.has(name) || name.startsWith("."))
            continue;
        const full = join(rootAbs, name);
        let isDir = false;
        try {
            isDir = statSync(full).isDirectory();
        }
        catch {
            continue;
        }
        if (isDir && depth > 0 && anyCssModule(full, depth - 1))
            return true;
        if (!isDir && name.endsWith(".module.css"))
            return true;
    }
    return false;
}
