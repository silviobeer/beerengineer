export function isTransientFailure(exitCode, stdout, stderr) {
    if (exitCode === 143 || exitCode === 137)
        return true;
    const combined = `${stdout}\n${stderr}`.trim();
    if (exitCode !== 0 && combined.length === 0)
        return true;
    if (/network error|socket hang up|ECONNRESET|ETIMEDOUT|temporary failure/i.test(combined))
        return true;
    return false;
}
// Node's child_process rejects (not exits) when the binary cannot be
// spawned. Claude Code CLI auto-updates briefly remove the versioned
// target behind ~/.local/bin/claude; a spawn that lands in that window
// fails with ENOENT. Treat it as transient so the retry path kicks in
// instead of the caller tearing down the run.
export function isTransientSpawnError(err) {
    if (!err || typeof err !== "object")
        return false;
    const code = err.code;
    return code === "ENOENT" || code === "EAGAIN" || code === "EMFILE" || code === "ENFILE";
}
export function transientRetryDelaysMs() {
    const configured = process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS?.trim();
    if (!configured)
        return [2000, 8000];
    const parsed = configured
        .split(",")
        .map(part => Number(part.trim()))
        .filter(value => Number.isFinite(value) && value >= 0);
    return parsed.length > 0 ? parsed : [2000, 8000];
}
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
