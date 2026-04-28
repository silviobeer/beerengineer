import { spawnCommand } from "../providerRuntime.js";
import { isTransientFailure, isTransientSpawnError, sleep, transientRetryDelaysMs } from "./_retry.js";
import { emitRetryMarker } from "./_stream.js";
/**
 * One implementation of the "invoke a provider CLI with retries + unknown-
 * session recovery" shell. Providers supply a small `ProviderDriver` — this
 * function owns the retry/transient/error-handling discipline.
 */
export async function invokeProviderCli(driver, input) {
    const retryDelays = transientRetryDelaysMs();
    const attempt = async (pass, activeInput) => {
        const command = driver.buildCommand(activeInput);
        const state = driver.createStreamState();
        const finishAttempt = async () => {
            if (driver.afterEach)
                await driver.afterEach({ input: activeInput, state });
        };
        let raw;
        try {
            raw = await spawnCommand(command, activeInput.prompt, activeInput.runtime.workspaceRoot, {
                onStdoutLine: driver.streamCallback(state),
            });
        }
        catch (err) {
            await finishAttempt();
            if (isTransientSpawnError(err) && pass < retryDelays.length) {
                emitRetryMarker(driver.tag, pass + 2, retryDelays.length + 1, retryDelays[pass] ?? 0);
                await sleep(retryDelays[pass] ?? 0);
                return attempt(pass + 1, activeInput);
            }
            throw err;
        }
        if (raw.exitCode !== 0) {
            const combined = `${raw.stdout}\n${raw.stderr}`;
            if (activeInput.session?.sessionId && driver.unknownSession(combined)) {
                await finishAttempt();
                const freshSession = { harness: activeInput.runtime.harness, sessionId: null };
                return attempt(pass, { ...activeInput, session: freshSession });
            }
            if (isTransientFailure(raw.exitCode, raw.stdout, raw.stderr) && pass < retryDelays.length) {
                if (driver.streamedSummary(state)) {
                    emitRetryMarker(driver.tag, pass + 2, retryDelays.length + 1, retryDelays[pass] ?? 0);
                }
                await finishAttempt();
                await sleep(retryDelays[pass] ?? 0);
                return attempt(pass + 1, activeInput);
            }
            await finishAttempt();
            throw new Error(`${activeInput.runtime.harness} exited with code ${raw.exitCode}: ${combined.trim() || "no output"}`);
        }
        try {
            return await driver.finalize({ input: activeInput, raw, command, state });
        }
        finally {
            await finishAttempt();
        }
    };
    return attempt(0, input);
}
