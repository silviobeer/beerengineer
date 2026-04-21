import { createHash } from "node:crypto";

export type WorkspaceBrowserUrl = {
  baseUrl: string;
  host: "127.0.0.1";
  port: number;
  readinessCommand: string;
};

const browserPortRangeStart = 3200;
const browserPortRangeSize = 4000;
const excludedBrowserPorts = new Set([
  3306,
  3389,
  3478,
  3690,
  5432,
  5672,
  6379,
  8080
]);

export function resolveWorkspaceBrowserUrl(workspaceKey: string): WorkspaceBrowserUrl {
  const normalized = workspaceKey.trim().toLowerCase() || "default";
  if (normalized === "default") {
    return {
      baseUrl: "http://127.0.0.1:3100",
      host: "127.0.0.1",
      port: 3100,
      readinessCommand: "npm --prefix apps/ui exec next -- dev --hostname 127.0.0.1 --port 3100"
    };
  }
  const digest = createHash("sha1").update(normalized).digest();
  let offset = digest.readUInt32BE(0) % browserPortRangeSize;
  let port = browserPortRangeStart + offset;
  for (let attempt = 1; excludedBrowserPorts.has(port); attempt += 1) {
    offset = (offset + digest[attempt % digest.length] + attempt * 17) % browserPortRangeSize;
    port = browserPortRangeStart + offset;
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    host: "127.0.0.1",
    port,
    readinessCommand: `npm --prefix apps/ui exec next -- dev --hostname 127.0.0.1 --port ${port}`
  };
}
