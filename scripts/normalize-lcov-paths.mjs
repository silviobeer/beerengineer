import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const reports = [
  { file: "coverage/engine/lcov.info", prefix: "apps/engine" },
  { file: "coverage/ui/lcov.info", prefix: "apps/ui" },
];

const sonarExcludedFiles = new Set([
  "apps/engine/src/core/git/shared.ts",
  "apps/engine/src/core/updateMode/readiness.ts",
  "apps/engine/src/core/updateMode/release.ts",
  "apps/engine/src/core/workspaces/shared.ts",
  "apps/engine/src/stages/execution/ralphStoryReview.ts",
  "apps/engine/src/stages/execution/setupContractVerifier.ts",
]);

function normalizeReport({ file, prefix }) {
  if (!existsSync(file)) {
    return;
  }

  const report = readFileSync(file, "utf8");
  const normalized = report
    .split("end_of_record\n")
    .map((record) => normalizeRecord(record, prefix))
    .filter(Boolean)
    .join("end_of_record\n");

  writeFileSync(file, normalized ? `${normalized}end_of_record\n` : "");
}

function normalizeRecord(record, prefix) {
  if (!record.trim()) {
    return "";
  }

  const sourceFile = record.match(/^SF:(.+)$/m)?.[1];
  if (!sourceFile) {
    return record;
  }

  const normalizedPath = sourceFile.replaceAll("\\", "/");
  const prefixedPath =
    path.isAbsolute(normalizedPath) || normalizedPath.startsWith(`${prefix}/`)
      ? normalizedPath
      : `${prefix}/${normalizedPath}`;

  if (sonarExcludedFiles.has(prefixedPath)) {
    return "";
  }

  return record.replace(/^SF:.+$/m, `SF:${prefixedPath}`);
}

for (const report of reports) {
  normalizeReport(report);
}
