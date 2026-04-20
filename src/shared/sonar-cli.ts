import { spawnSync } from "node:child_process";

export type SonarCliState = {
  available: boolean;
  loggedIn: boolean;
  detail: string | null;
};

export function detectSonarCliState(workspaceRoot: string): SonarCliState {
  const status = spawnSync("sonar", ["auth", "status"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });

  if (status.error) {
    const errorCode = (status.error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      return {
        available: false,
        loggedIn: false,
        detail: null
      };
    }
    return {
      available: false,
      loggedIn: false,
      detail: status.error.message
    };
  }

  const output = `${status.stdout ?? ""}\n${status.stderr ?? ""}`.trim();
  return {
    available: true,
    loggedIn: status.status === 0,
    detail: output.length > 0 ? output : null
  };
}
