import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"

export async function invokeOpenCode(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  throw new Error(`Harness "${input.runtime.harness}" is not implemented yet`)
}
