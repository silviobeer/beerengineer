import { spawnSync } from "node:child_process";

const coderabbitCliAliases = ["cr", "coderabbit"] as const;

export type CoderabbitCliState = {
  available: boolean;
  binary: (typeof coderabbitCliAliases)[number] | null;
  loggedIn: boolean;
  detail: string | null;
};

export function detectCoderabbitCliState(workspaceRoot: string): CoderabbitCliState {
  for (const binary of coderabbitCliAliases) {
    const status = spawnSync(binary, ["auth", "status"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 1000
    });

    if (status.error) {
      const errorCode = (status.error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        continue;
      }
      return {
        available: false,
        binary: null,
        loggedIn: false,
        detail: status.error.message
      };
    }

    const output = `${status.stdout ?? ""}\n${status.stderr ?? ""}`.trim();
    return {
      available: true,
      binary,
      loggedIn: inferCoderabbitLoggedIn(output, status.status ?? null),
      detail: output.length > 0 ? output : null
    };
  }

  return {
    available: false,
    binary: null,
    loggedIn: false,
    detail: null
  };
}

function inferCoderabbitLoggedIn(output: string, exitStatus: number | null): boolean {
  const events = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);

  for (const event of events) {
    const booleanState = readBooleanState(event);
    if (booleanState !== null) {
      return booleanState;
    }
  }

  return exitStatus === 0;
}

function readBooleanState(event: Record<string, unknown>): boolean | null {
  const candidates = [event.authenticated, event.loggedIn, event.signedIn];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  const statusValue = typeof event.status === "string" ? event.status.toLowerCase() : null;
  if (!statusValue) {
    return null;
  }
  if (["authenticated", "logged_in", "signed_in", "ok", "ready"].includes(statusValue)) {
    return true;
  }
  if (["unauthenticated", "logged_out", "signed_out", "not_authenticated"].includes(statusValue)) {
    return false;
  }
  return null;
}
