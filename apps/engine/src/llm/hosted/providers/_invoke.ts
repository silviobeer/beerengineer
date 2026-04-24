import { spawnCommand, type HostedCliExecutionResult, type HostedProviderInvokeInput, type HostedSession } from "../providerRuntime.js"
import { isTransientFailure, isTransientSpawnError, sleep, transientRetryDelaysMs } from "./_retry.js"
import { emitRetryMarker } from "./_stream.js"

export type ProviderDriver<State> = {
  /** Short provider tag used in retry markers ("claude", "codex", …). */
  tag: string
  /** Build the child-process argv for one invocation. Called per attempt. */
  buildCommand(input: HostedProviderInvokeInput): string[]
  /** Fresh mutable state that the stream callback will populate. */
  createStreamState(): State
  /** Stream callback — invoked on every stdout line during the child's run. */
  streamCallback(state: State): (line: string) => void
  /** Whether the stream callback has emitted at least one user-visible summary.
   *  Controls whether a retry marker is emitted for transient exit-code failures. */
  streamedSummary(state: State): boolean
  /** Detect "session id unknown / expired" messages in the combined output so
   *  the helper can retry once with a fresh session. */
  unknownSession(combinedOutput: string): boolean
  /** Produce the final result once the child exits cleanly. Lifecycle hooks
   *  (temp-file cleanup etc.) run via `afterEach` below. */
  finalize(params: {
    input: HostedProviderInvokeInput
    raw: Awaited<ReturnType<typeof spawnCommand>>
    command: string[]
    state: State
  }): Promise<HostedCliExecutionResult>
  /** Optional cleanup invoked after every attempt (whether success or
   *  throw), used by providers that allocate temp dirs / files. */
  afterEach?(params: { input: HostedProviderInvokeInput; state: State }): Promise<void>
}

/**
 * One implementation of the "invoke a provider CLI with retries + unknown-
 * session recovery" shell. Providers supply a small `ProviderDriver` — this
 * function owns the retry/transient/error-handling discipline.
 */
export async function invokeProviderCli<State>(
  driver: ProviderDriver<State>,
  input: HostedProviderInvokeInput,
): Promise<HostedCliExecutionResult> {
  const retryDelays = transientRetryDelaysMs()

  const attempt = async (pass: number, activeInput: HostedProviderInvokeInput): Promise<HostedCliExecutionResult> => {
    const command = driver.buildCommand(activeInput)
    const state = driver.createStreamState()
    const finishAttempt = async (): Promise<void> => {
      if (driver.afterEach) await driver.afterEach({ input: activeInput, state })
    }

    let raw
    try {
      raw = await spawnCommand(command, activeInput.prompt, activeInput.runtime.workspaceRoot, {
        onStdoutLine: driver.streamCallback(state),
      })
    } catch (err) {
      await finishAttempt()
      if (isTransientSpawnError(err) && pass < retryDelays.length) {
        emitRetryMarker(driver.tag, pass + 2, retryDelays.length + 1, retryDelays[pass] ?? 0)
        await sleep(retryDelays[pass] ?? 0)
        return attempt(pass + 1, activeInput)
      }
      throw err
    }

    if (raw.exitCode !== 0) {
      const combined = `${raw.stdout}\n${raw.stderr}`
      if (activeInput.session?.sessionId && driver.unknownSession(combined)) {
        await finishAttempt()
        const freshSession: HostedSession = { provider: activeInput.runtime.provider, sessionId: null }
        return attempt(pass, { ...activeInput, session: freshSession })
      }
      if (isTransientFailure(raw.exitCode, raw.stdout, raw.stderr) && pass < retryDelays.length) {
        if (driver.streamedSummary(state)) {
          emitRetryMarker(driver.tag, pass + 2, retryDelays.length + 1, retryDelays[pass] ?? 0)
        }
        await finishAttempt()
        await sleep(retryDelays[pass] ?? 0)
        return attempt(pass + 1, activeInput)
      }
      await finishAttempt()
      throw new Error(`${activeInput.runtime.provider} exited with code ${raw.exitCode}: ${combined.trim() || "no output"}`)
    }

    try {
      return await driver.finalize({ input: activeInput, raw, command, state })
    } finally {
      await finishAttempt()
    }
  }

  return attempt(0, input)
}
