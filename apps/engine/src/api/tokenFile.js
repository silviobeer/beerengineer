import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
/**
 * The engine binds to 127.0.0.1 with permissive CORS so the paired UI on a
 * different port can talk to it. Without a shared secret, any browser tab
 * the user visits could issue mutating requests (POST /workspaces,
 * DELETE /workspaces/:key?purge=1, …) from its own origin. We require an
 * x-beerengineer-token header on all mutating methods.
 *
 * The engine writes the token to a file on startup; the UI reads it.
 * Location: `$XDG_STATE_HOME/beerengineer/api.token` (falls back to
 * `~/.local/state/beerengineer/api.token`). The env var
 * `BEERENGINEER_API_TOKEN_FILE` overrides the path. If
 * `BEERENGINEER_API_TOKEN` is set directly, both sides use that value and
 * the file is a no-op.
 */
function defaultTokenPath() {
    const envPath = process.env.BEERENGINEER_API_TOKEN_FILE;
    if (envPath)
        return resolve(envPath);
    const xdgState = process.env.XDG_STATE_HOME;
    const base = xdgState ? resolve(xdgState) : join(homedir(), ".local", "state");
    return join(base, "beerengineer", "api.token");
}
export function resolveApiTokenFilePath() {
    return defaultTokenPath();
}
export function writeApiTokenFile(token) {
    const path = defaultTokenPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
    return path;
}
export function readApiTokenFile() {
    try {
        const raw = readFileSync(defaultTokenPath(), "utf8").trim();
        return raw || null;
    }
    catch {
        return null;
    }
}
