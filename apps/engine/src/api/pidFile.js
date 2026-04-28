import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
function defaultPidPath() {
    const envPath = process.env.BEERENGINEER_ENGINE_PID_FILE;
    if (envPath)
        return resolve(envPath);
    const xdgState = process.env.XDG_STATE_HOME;
    const base = xdgState ? resolve(xdgState) : join(homedir(), ".local", "state");
    return join(base, "beerengineer", "engine.pid");
}
export function resolveEnginePidFilePath() {
    return defaultPidPath();
}
export function writeEnginePidFile(record) {
    const path = defaultPidPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return path;
}
export function readEnginePidFile() {
    try {
        return JSON.parse(readFileSync(defaultPidPath(), "utf8"));
    }
    catch {
        return null;
    }
}
export function removeEnginePidFile() {
    try {
        rmSync(defaultPidPath(), { force: true });
    }
    catch { }
}
