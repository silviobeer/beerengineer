export async function assertSeedIdempotent(input: { runSeed(): Promise<unknown>; snapshot(): Promise<unknown> }): Promise<{ ok: true } | { ok: false; reason: string }> {
  await input.runSeed()
  const before = JSON.stringify(await input.snapshot())
  await input.runSeed()
  const after = JSON.stringify(await input.snapshot())
  return before === after ? { ok: true } : { ok: false, reason: "seed changed logical state on second run" }
}
