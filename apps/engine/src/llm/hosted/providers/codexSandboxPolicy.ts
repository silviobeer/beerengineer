import type { RuntimePolicy } from "../../runtimePolicy.js"

export type CodexSandboxCapability = "supported" | "unsupported" | "unknown"

export type CodexSandboxResolution = {
  bypass: boolean
  source: "policy" | "explicit" | "capability" | "default"
}

type CapabilityProbe = () => Promise<CodexSandboxCapability>

const TRUE_VALUES = new Set(["1", "true", "yes"])
const FALSE_VALUES = new Set(["0", "false", "no"])

let cachedCapability: CodexSandboxCapability = "unknown"
let inFlightProbe: Promise<CodexSandboxCapability> | null = null
let capabilityProbe: CapabilityProbe = async () => "unknown"

function normalizeCapability(value: CodexSandboxCapability): CodexSandboxCapability {
  return value === "supported" || value === "unsupported" ? value : "unknown"
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseCodexSandboxBypassOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.BEERENGINEER_CODEX_SANDBOX_BYPASS?.trim().toLowerCase()
  if (!raw) return null
  if (TRUE_VALUES.has(raw)) return true
  if (FALSE_VALUES.has(raw)) return false
  return null
}

export function codexSandboxBypassEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseCodexSandboxBypassOverride(env) === true
}

function rememberCapability(capability: CodexSandboxCapability): void {
  const normalized = normalizeCapability(capability)
  if (normalized !== "unknown") cachedCapability = normalized
}

function startCapabilityProbe(): Promise<CodexSandboxCapability> {
  if (cachedCapability !== "unknown") return Promise.resolve(cachedCapability)
  if (!inFlightProbe) {
    inFlightProbe = capabilityProbe()
      .then(capability => {
        rememberCapability(capability)
        return normalizeCapability(capability)
      })
      .catch(() => "unknown" as const)
      .finally(() => {
        inFlightProbe = null
      })
  }
  return inFlightProbe
}

export async function getCodexSandboxCapability(
  timeoutMs = 1000,
): Promise<CodexSandboxCapability> {
  if (cachedCapability !== "unknown") return cachedCapability
  if (timeoutMs <= 0) {
    void startCapabilityProbe()
    return "unknown"
  }
  return Promise.race([
    startCapabilityProbe(),
    sleep(timeoutMs).then(() => "unknown" as const),
  ])
}

export async function resolveCodexSandboxBypass(
  mode: RuntimePolicy["mode"],
  env: NodeJS.ProcessEnv = process.env,
  probeTimeoutMs = 1000,
): Promise<CodexSandboxResolution> {
  if (mode === "no-tools") return { bypass: false, source: "policy" }
  if (mode === "unsafe-autonomous-write") return { bypass: true, source: "policy" }

  const explicit = parseCodexSandboxBypassOverride(env)
  if (explicit !== null) return { bypass: explicit, source: "explicit" }

  const capability = await getCodexSandboxCapability(probeTimeoutMs)
  if (capability === "unsupported") return { bypass: true, source: "capability" }
  if (capability === "supported") return { bypass: false, source: "capability" }
  return { bypass: false, source: "default" }
}

export function markCodexSandboxCapabilitySupported(): void {
  rememberCapability("supported")
}

export function markCodexSandboxCapabilityUnsupported(): void {
  rememberCapability("unsupported")
}

export function isKnownCodexBwrapNetworkingFailure(text: string): boolean {
  return (
    /bwrap:.*Failed RTM_NEWADDR: Operation not permitted/i.test(text) ||
    /bwrap:.*No permissions? to create new namespace/i.test(text) ||
    /bwrap:.*kernel does not allow non-privileged user namespaces/i.test(text)
  )
}

export function shouldRetryCodexWithSandboxBypass(input: {
  error: unknown
  mode: RuntimePolicy["mode"]
  env?: NodeJS.ProcessEnv
  alreadyBypassing: boolean
}): boolean {
  if (input.mode === "no-tools" || input.mode === "unsafe-autonomous-write") return false
  if (input.alreadyBypassing) return false
  if (parseCodexSandboxBypassOverride(input.env) !== null) return false
  return isKnownCodexBwrapNetworkingFailure(errorText(input.error))
}

export function buildCodexWorkerStartFailure(error: unknown): Error {
  const message = errorText(error).trim()
  return new Error(
    message.toLowerCase().startsWith("worker start failed:")
      ? message
      : `worker start failed: ${message}`,
  )
}

export function buildCodexBypassRetryFailure(
  firstError: unknown,
  retryError: unknown,
): Error {
  return buildCodexWorkerStartFailure(
    `codex sandbox retry failed after a default bubblewrap networking error. ` +
      `first attempt: ${errorText(firstError).trim()} retry attempt: ${errorText(retryError).trim()}`,
  )
}

export function resetCodexSandboxPolicyForTests(): void {
  cachedCapability = "unknown"
  inFlightProbe = null
  capabilityProbe = async () => "unknown"
}

export function setCodexSandboxCapabilityProbeForTests(
  probe: CapabilityProbe,
): void {
  cachedCapability = "unknown"
  inFlightProbe = null
  capabilityProbe = probe
}
