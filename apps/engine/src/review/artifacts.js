import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export function reviewCycleArtifactsDir(baseDir, reviewCycle) {
    return join(baseDir, "review-tool-artifacts", `cycle-${reviewCycle}`);
}
export async function writeArtifactText(dir, name, content) {
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, content, "utf8");
    return path;
}
export async function writeArtifactJson(dir, name, value) {
    return writeArtifactText(dir, name, `${JSON.stringify(value, null, 2)}\n`);
}
