import { relative, resolve, sep } from "node:path";

import { AppError } from "./errors.js";

function isEqualOrDescendant(targetPath: string, basePath: string): boolean {
  const relativePath = relative(basePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

export function isUnsafeWorkspaceRoot(rootPath: string, repoRoot: string): boolean {
  const resolvedRootPath = resolve(rootPath);
  const resolvedRepoRoot = resolve(repoRoot);
  return isEqualOrDescendant(resolvedRootPath, resolvedRepoRoot);
}

export function assertSafeWorkspaceRoot(rootPath: string, repoRoot: string): void {
  if (!isUnsafeWorkspaceRoot(rootPath, repoRoot)) {
    return;
  }
  throw new AppError(
    "WORKSPACE_ROOT_UNSAFE",
    `Workspace root ${resolve(rootPath)} is inside the BeerEngineer installation/repository root ${resolve(repoRoot)}`
  );
}
