export class BlockedRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedRunError"
  }
}

export function isBlockedRunError(error: unknown): error is BlockedRunError {
  return error instanceof Error && error.name === "BlockedRunError"
}
