export function isTransientFailure(exitCode: number, stdout: string, stderr: string): boolean {
  if (exitCode === 143 || exitCode === 137) return true
  const combined = `${stdout}\n${stderr}`.trim()
  if (exitCode !== 0 && combined.length === 0) return true
  if (/network error|socket hang up|ECONNRESET|ETIMEDOUT|temporary failure/i.test(combined)) return true
  return false
}

export function transientRetryDelaysMs(): number[] {
  const configured = process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS?.trim()
  if (!configured) return [2000, 8000]
  const parsed = configured
    .split(",")
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value) && value >= 0)
  return parsed.length > 0 ? parsed : [2000, 8000]
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
