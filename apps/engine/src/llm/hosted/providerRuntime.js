import { spawn } from "node:child_process";
import { lookupPort } from "../../core/portAllocator.js";
import { previewHost, previewUrlForPort } from "../../core/previewHost.js";
export function spawnCommand(command, stdinText, cwd, options = {}) {
    return new Promise((resolve, reject) => {
        const assignedPort = lookupPort(cwd);
        const host = previewHost();
        const child = spawn(command[0], command.slice(1), {
            cwd,
            env: {
                ...process.env,
                ...(assignedPort
                    ? {
                        PORT: String(assignedPort),
                        BEERENGINEER_PREVIEW_PORT: String(assignedPort),
                        BEERENGINEER_PREVIEW_HOST: host,
                        BEERENGINEER_PREVIEW_URL: previewUrlForPort(assignedPort),
                    }
                    : {}),
            },
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        let lineBuffer = "";
        let settled = false;
        let stdinClosed = false;
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            fn();
        };
        const ignoreBrokenPipe = (err) => {
            if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")
                return;
            settle(() => reject(err));
        };
        const flushLines = (final = false) => {
            if (!options.onStdoutLine)
                return;
            const parts = lineBuffer.split(/\r?\n/);
            lineBuffer = final ? "" : parts.pop() ?? "";
            for (const line of parts) {
                if (line.length === 0)
                    continue;
                try {
                    options.onStdoutLine(line);
                }
                catch {
                    // Never let a logging callback take down the subprocess waiter.
                }
            }
        };
        child.once("error", err => settle(() => reject(err)));
        child.stdin.on("error", ignoreBrokenPipe);
        child.stdin.on("close", () => {
            stdinClosed = true;
        });
        child.stdout.on("data", chunk => {
            stdoutChunks.push(chunk);
            if (options.onStdoutLine) {
                lineBuffer += chunk.toString("utf8");
                flushLines();
            }
        });
        child.stderr.on("data", chunk => stderrChunks.push(chunk));
        child.once("close", code => {
            flushLines(true);
            settle(() => resolve({
                stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
                exitCode: code ?? 1,
            }));
        });
        if (stdinText != null && !stdinClosed && !child.stdin.destroyed) {
            child.stdin.write(stdinText, err => {
                if (err)
                    ignoreBrokenPipe(err);
            });
        }
        if (!stdinClosed && !child.stdin.destroyed)
            child.stdin.end();
    });
}
