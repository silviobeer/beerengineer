import type { HostedCliExecutionResult, HostedProviderInvokeInput } from "../providerRuntime.js"

export async function invokeOpenCode(input: HostedProviderInvokeInput): Promise<HostedCliExecutionResult> {
  throw new Error(`Provider "${input.runtime.provider}" is not implemented yet`)
}
