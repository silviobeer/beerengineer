import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { AppError } from "./errors.js";

type ResolveUserDataDirInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
};

function resolveHomeDirectory(input: ResolveUserDataDirInput): string {
  const env = input.env ?? process.env;
  const explicitHome = input.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir();
  if (!explicitHome) {
    throw new AppError("USER_DATA_DIR_UNRESOLVABLE", "Could not resolve a home directory for BeerEngineer user data");
  }
  return resolve(explicitHome);
}

export function resolveUserDataDir(input: ResolveUserDataDirInput = {}): string {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;

  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData && appData.length > 0) {
      return resolve(appData, "beerengineer");
    }
    return join(resolveHomeDirectory(input), "AppData", "Roaming", "beerengineer");
  }

  if (platform === "darwin") {
    return join(resolveHomeDirectory(input), "Library", "Application Support", "beerengineer");
  }

  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "beerengineer");
  }
  return join(resolveHomeDirectory(input), ".local", "share", "beerengineer");
}

export function resolveDefaultDbPath(input: ResolveUserDataDirInput = {}): string {
  return join(resolveUserDataDir(input), "beerengineer.sqlite");
}

export function resolveDefaultAgentRuntimeOverridePath(input: ResolveUserDataDirInput = {}): string {
  return join(resolveUserDataDir(input), "config", "agent-runtime.override.json");
}
