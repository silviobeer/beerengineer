import { spawn } from "node:child_process";
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;
export async function commandExists(command) {
    const result = await runCommand([command, "--version"], process.cwd(), {
        timeoutMs: VERSION_PROBE_TIMEOUT_MS,
    });
    return result.ok;
}
export function runCommand(command, cwd, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    return new Promise(resolve => {
        const [commandName, ...args] = command;
        if (!commandName) {
            resolve({
                ok: false,
                exitCode: 1,
                stdout: "",
                stderr: "missing command",
                combinedOutput: "missing command",
            });
            return;
        }
        const child = spawn(commandName, args, {
            cwd,
            env: { ...process.env, ...opts.env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        child.stdout.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderrChunks.push(Buffer.from(chunk)));
        child.on("error", err => {
            settle({
                ok: false,
                exitCode: 1,
                stdout: "",
                stderr: err.message,
                combinedOutput: err.message,
                timedOut,
            });
        });
        child.on("close", code => {
            const stdout = Buffer.concat(stdoutChunks).toString("utf8");
            const stderr = Buffer.concat(stderrChunks).toString("utf8");
            const extra = timedOut ? `\n[timed out after ${timeoutMs}ms]` : "";
            settle({
                ok: !timedOut && code === 0,
                exitCode: code ?? 1,
                stdout,
                stderr,
                combinedOutput: [stdout, stderr].filter(Boolean).join("\n") + extra,
                timedOut,
            });
        });
    });
}
