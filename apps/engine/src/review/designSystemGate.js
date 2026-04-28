import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
const HEX_COLOR = /(?:^|\W)(#[0-9a-fA-F]{3,8})\b/;
const TAILWIND_PALETTE = /\b([a-z]+)-([a-z]+)-(\d{2,3})\b/;
const ROUNDED = /\brounded(?:-[\w/[\]-]+)?\b/;
const BORDER_RADIUS_NONZERO = /border-radius\s*:\s*(?!0(?:[a-z%]+)?\b)[^;]+/i;
const TAILWIND_PREFIXES = new Set(["bg", "text", "border", "ring", "outline", "fill", "stroke", "from", "to", "via"]);
const TAILWIND_COLORS = new Set([
    "zinc",
    "slate",
    "gray",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
]);
function runGit(args, cwd) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { ok: result.status === 0, stdout: result.stdout ?? "" };
}
function shouldSkipHexRule(file) {
    return file.endsWith("design-tokens.css") || file.endsWith(".test.tsx");
}
function isTailwindPaletteMatch(match) {
    return match !== null && TAILWIND_PREFIXES.has(match[1]) && TAILWIND_COLORS.has(match[2]);
}
function readUntrackedAddedLines(workspaceRoot, file) {
    const absolute = join(workspaceRoot, file);
    if (!existsSync(absolute))
        return [];
    return readFileSync(absolute, "utf8")
        .split(/\r?\n/)
        .map((content, index) => ({ file, line: index + 1, content }));
}
function parseAddedLines(diffText) {
    const lines = diffText.split(/\r?\n/);
    const added = [];
    let currentFile = "";
    let currentLine = 0;
    for (const line of lines) {
        if (line.startsWith("+++ b/")) {
            currentFile = line.slice("+++ b/".length);
            continue;
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
            currentLine = Number(hunk[1]);
            continue;
        }
        if (!currentFile)
            continue;
        if (line.startsWith("+") && !line.startsWith("+++")) {
            added.push({ file: currentFile, line: currentLine, content: line.slice(1) });
            currentLine++;
            continue;
        }
        if (line.startsWith("-") && !line.startsWith("---"))
            continue;
        currentLine++;
    }
    return added;
}
function collectAddedLines(input) {
    const trackedFiles = input.changedFiles.filter(file => existsSync(join(input.workspaceRoot, file)));
    const untracked = new Set(input.changedFiles.filter(file => !runGit(["ls-files", "--error-unmatch", file], input.workspaceRoot).ok));
    const addedFromUntracked = Array.from(untracked).flatMap(file => readUntrackedAddedLines(input.workspaceRoot, file));
    const trackedTargets = trackedFiles.filter(file => !untracked.has(file));
    if (trackedTargets.length === 0)
        return addedFromUntracked;
    const diffArgs = input.baselineSha
        ? ["diff", "--unified=0", input.baselineSha, "--", ...trackedTargets]
        : ["diff", "--unified=0", "--", ...trackedTargets];
    const diff = runGit(diffArgs, input.workspaceRoot);
    return [...parseAddedLines(diff.stdout), ...addedFromUntracked];
}
export async function runDesignSystemGate(input) {
    const relevantFiles = input.changedFiles.filter(file => {
        const extension = extname(file);
        return [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".mdx"].includes(extension);
    });
    if (relevantFiles.length === 0) {
        return {
            status: "skipped",
            passed: true,
            findings: [],
            summary: "No design-relevant changed files.",
        };
    }
    const findings = [];
    for (const line of collectAddedLines({ ...input, changedFiles: relevantFiles })) {
        if (!shouldSkipHexRule(line.file) && HEX_COLOR.test(line.content)) {
            findings.push({
                source: "design-system",
                severity: "high",
                message: `design-system-violation: ${line.file}:${line.line} used a hardcoded hex color — replace it with a design token.`,
            });
        }
        const paletteMatch = TAILWIND_PALETTE.exec(line.content);
        if (isTailwindPaletteMatch(paletteMatch)) {
            findings.push({
                source: "design-system",
                severity: "high",
                message: `design-system-violation: ${line.file}:${line.line} used Tailwind palette class '${paletteMatch[0]}' — replace it with a design token.`,
            });
        }
        const roundedMatch = ROUNDED.exec(line.content);
        if (roundedMatch) {
            findings.push({
                source: "design-system",
                severity: "high",
                message: `design-system-violation: ${line.file}:${line.line} used rounded styling '${roundedMatch[0]}' — components must stay sharp-cornered.`,
            });
        }
        if (BORDER_RADIUS_NONZERO.test(line.content)) {
            findings.push({
                source: "design-system",
                severity: "high",
                message: `design-system-violation: ${line.file}:${line.line} set a non-zero border-radius — components must stay sharp-cornered.`,
            });
        }
    }
    return {
        status: "ran",
        passed: findings.length === 0,
        findings,
        summary: findings.length === 0
            ? "Design-system gate passed."
            : `Design-system gate found ${findings.length} issue(s).`,
    };
}
