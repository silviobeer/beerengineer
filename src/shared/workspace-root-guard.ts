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

export function assertSafeWorkspaceRoot(
  rootPath: string,
  repoRoot: string,
  options?: {
    allowRepoRoot?: boolean;
  }
): void {
  const resolvedRootPath = resolve(rootPath);
  const resolvedRepoRoot = resolve(repoRoot);
  if (options?.allowRepoRoot && resolvedRootPath === resolvedRepoRoot) {
    return;
  }
  if (!isUnsafeWorkspaceRoot(resolvedRootPath, resolvedRepoRoot)) {
    return;
  }
  throw new AppError(
    "WORKSPACE_ROOT_UNSAFE",
    `Workspace root ${resolvedRootPath} is inside the BeerEngineer installation/repository root ${resolvedRepoRoot}`
  );
}
