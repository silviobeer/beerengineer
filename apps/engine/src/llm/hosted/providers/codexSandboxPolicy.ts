import { spawn } from "node:child_process"
import { accessSync, constants as fsConstants } from "node:fs"
import type { RuntimePolicy } from "../../runtimePolicy.js"

export type CodexSandboxCapability = "supported" | "unsupported" | "unknown"

export type CodexSandboxResolution = {
  bypass: boolean
  source: "policy" | "explicit" | "capability" | "default"
}

type CapabilityProbe = () => Promise<CodexSandboxCapability>
type CodexSandboxCapabilityStore = {
  load: () => string | null | undefined
  persist: (capability: Exclude<CodexSandboxCapability, "unknown">) => void
}

const TRUE_VALUES = new Set(["1", "true", "yes"])
const FALSE_VALUES = new Set(["0", "false", "no"])
const DEFAULT_PROBE_TIMEOUT_MS = 2000
const BWRAP_BINARY_PATHS = [
  "/usr/bin/bwrap",
  "/bin/bwrap",
  "/usr/local/bin/bwrap",
  "/run/current-system/sw/bin/bwrap",
]
const BWRAP_PROBE_ARGS = [
  "--die-with-parent",
  "--unshare-user",
  "--unshare-pid",
  "--unshare-net",
  "--proc",
  "/proc",
  "--dev",
  "/dev",
  "--ro-bind",
  "/",
  "/",
  "--chdir",
  "/",
  "/bin/sh",
  "-lc",
  "true",
]

let cachedCapability: CodexSandboxCapability = "unknown"
let inFlightProbe: Promise<CodexSandboxCapability> | null = null
let capabilityProbe: CapabilityProbe = () => runDefaultCapabilityProbe()
let capabilityStore: CodexSandboxCapabilityStore | null = null

function normalizeCapability(value: string | null | undefined): CodexSandboxCapability {
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
  if (raw === undefined || raw === "") return null
  if (TRUE_VALUES.has(raw)) return true
  if (FALSE_VALUES.has(raw)) return false
  return null
}

export function codexSandboxBypassEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseCodexSandboxBypassOverride(env) === true
}

function rememberCapability(
  capability: CodexSandboxCapability,
  options: { persist?: boolean } = {},
): void {
  const normalized = normalizeCapability(capability)
  if (normalized === "unknown") return
  cachedCapability = normalized
  if (options.persist === false || capabilityStore === null) return
  try {
    capabilityStore.persist(normalized)
  } catch {
    // Persistence failures degrade to in-memory caching only.
  }
}

function hydrateCapabilityFromStore(): "known" | "missing" | "invalid" {
  if (cachedCapability !== "unknown") return "known"
  if (capabilityStore === null) return "missing"
  try {
    const persisted = capabilityStore.load()
    if (persisted === null || persisted === undefined || persisted === "unknown") {
      return "missing"
    }

    const normalized = normalizeCapability(persisted)
    if (normalized === "unknown") {
      return "invalid"
    }

    rememberCapability(normalized, { persist: false })
    return "known"
  } catch {
    // Invalid or unreadable persisted state behaves as unknown.
    return "invalid"
  }
}

export function isKnownCodexSandboxCapabilityFailure(text: string): boolean {
  return (
    isKnownCodexBwrapNetworkingFailure(text)
    || /\bCAP_NET_ADMIN\b/i.test(text)
    || /\bcap_net_admin\b/i.test(text)
    || /\bbwrap:\s*command not found\b/i.test(text)
    || /\bspawn bwrap\b.*\bENOENT\b/i.test(text)
    || /\bbwrap:.*No such file or directory\b/i.test(text)
    || /\bbwrap:.*Operation not permitted\b/i.test(text)
  )
}

function classifyProbeFailure(text: string): CodexSandboxCapability {
  if (
    isKnownCodexSandboxCapabilityFailure(text)
    || /\boperation not permitted\b/i.test(text)
  ) {
    return "unsupported"
  }
  return "unknown"
}

function resolveBwrapBinaryPath(): string | null {
  for (const candidate of BWRAP_BINARY_PATHS) {
    try {
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Keep checking the fixed candidate list.
    }
  }
  return null
}

function runDefaultCapabilityProbe(): Promise<CodexSandboxCapability> {
  return new Promise(resolve => {
    const bwrapPath = resolveBwrapBinaryPath()
    if (!bwrapPath) {
      resolve("unsupported")
      return
    }

    let settled = false
    let stderr = ""
    const child = spawn(bwrapPath, BWRAP_PROBE_ARGS, {
      stdio: ["ignore", "ignore", "pipe"],
    })

    const finish = (capability: CodexSandboxCapability): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(capability)
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      finish("unknown")
    }, DEFAULT_PROBE_TIMEOUT_MS)

    child.on("error", error => {
      const errno = error as NodeJS.ErrnoException
      if (errno.code === "ENOENT") {
        finish("unsupported")
        return
      }
      finish("unknown")
    })
    child.stderr?.on("data", chunk => {
      stderr += chunk.toString()
    })
    child.on("close", code => {
      if (code === 0) {
        finish("supported")
        return
      }
      finish(classifyProbeFailure(stderr))
    })
  })
}

function startCapabilityProbe(): Promise<CodexSandboxCapability> {
  hydrateCapabilityFromStore()
  if (cachedCapability !== "unknown") return Promise.resolve(cachedCapability)
  inFlightProbe ??= capabilityProbe()
    .then(capability => {
      rememberCapability(capability)
      return normalizeCapability(capability)
    })
    .catch(() => "unknown" as const)
    .finally(() => {
      inFlightProbe = null
    })
  return inFlightProbe
}

export async function getCodexSandboxCapability(
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<CodexSandboxCapability> {
  hydrateCapabilityFromStore()
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

export async function primeCodexSandboxCapabilityDetection(
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<void> {
  await getCodexSandboxCapability(timeoutMs)
}

export async function resolveCodexSandboxBypass(
  mode: RuntimePolicy["mode"],
  env: NodeJS.ProcessEnv = process.env,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<CodexSandboxResolution> {
  if (mode === "no-tools") return { bypass: false, source: "policy" }
  if (mode === "unsafe-autonomous-write") return { bypass: true, source: "policy" }

  const explicit = parseCodexSandboxBypassOverride(env)
  if (explicit !== null) return { bypass: explicit, source: "explicit" }

  if (hydrateCapabilityFromStore() === "invalid") {
    void startCapabilityProbe()
    return { bypass: true, source: "default" }
  }

  const capability = await getCodexSandboxCapability(probeTimeoutMs)
  if (capability === "unsupported") return { bypass: true, source: "capability" }
  if (capability === "supported") return { bypass: false, source: "capability" }
  return { bypass: true, source: "default" }
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
  return isKnownCodexSandboxCapabilityFailure(errorText(input.error))
}

export function buildCodexWorkerStartFailure(error: unknown): Error {
  const message = errorText(error).trim()
  return new Error(
    message.toLowerCase().startsWith("worker start failed:")
      ? message
      : `worker start failed: ${message}`,
  )
}

export function isHostedWorkerLaunchFailure(error: unknown): boolean {
  const message = errorText(error)
  return (
    /\bexited with code \d+\b/i.test(message) ||
    /\bspawn\b/i.test(message) ||
    /\bENOENT\b/.test(message) ||
    /\bcodex:sdk turn failed\b/i.test(message) ||
    /\bcodex:sdk error\b/i.test(message)
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
  capabilityProbe = () => runDefaultCapabilityProbe()
  capabilityStore = null
}

export function setCodexSandboxCapabilityProbeForTests(
  probe: CapabilityProbe,
): void {
  cachedCapability = "unknown"
  inFlightProbe = null
  capabilityProbe = probe
}

export function setCodexSandboxCapabilityStore(
  store: CodexSandboxCapabilityStore | null,
): void {
  capabilityStore = store
  hydrateCapabilityFromStore()
}
