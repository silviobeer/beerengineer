export const CAPABILITY_EXIT_CODES = {
  success: 0,
  usage: 20,
  transport: 30,
  requiredFailure: 40,
  optionalWarning: 41,
} as const

export type CapabilityExitKind = keyof typeof CAPABILITY_EXIT_CODES

export function capabilityExitCode(kind: CapabilityExitKind): number {
  return CAPABILITY_EXIT_CODES[kind]
}
