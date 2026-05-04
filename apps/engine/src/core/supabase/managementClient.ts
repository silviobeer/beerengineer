import { managementEndpoints, SUPABASE_MANAGEMENT_API_BASE_URL } from "./managementEndpoints.js"
import type { SupabaseBranch, SupabaseProject } from "./types.js"

export type SupabaseManagementClientOptions = {
  token: string
  fetch?: typeof fetch
  baseUrl?: string
}

export class SupabaseManagementError extends Error {
  constructor(
    public readonly kind: "provider" | "rate_limit" | "network",
    message: string,
    public readonly status?: number,
    public readonly retryAfter?: string | null,
  ) {
    super(message)
    this.name = "SupabaseManagementError"
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

async function readProviderMessage(response: Response): Promise<string> {
  const fallback = `Supabase Management API returned ${response.status}`
  try {
    const body = await response.json() as { message?: unknown; error?: unknown }
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : fallback
    return message.replaceAll(/sbp_[A-Za-z0-9_-]+/g, "sbp_[redacted]")
  } catch {
    return fallback
  }
}

export class SupabaseManagementClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: SupabaseManagementClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.baseUrl = (options.baseUrl ?? SUPABASE_MANAGEMENT_API_BASE_URL).replace(/\/$/, "")
  }

  async listProjects(): Promise<SupabaseProject[]> {
    return asArray<SupabaseProject>(await this.request(managementEndpoints.listProjects))
  }

  async getProject(projectRef: string): Promise<SupabaseProject> {
    return await this.request(managementEndpoints.getProject(projectRef)) as SupabaseProject
  }

  async listBranches(projectRef: string): Promise<SupabaseBranch[]> {
    return asArray<SupabaseBranch>(await this.request(managementEndpoints.listBranches(projectRef)))
  }

  private async request(path: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: "application/json",
        },
      })
    } catch (err) {
      throw new SupabaseManagementError("network", err instanceof Error ? err.message : "Supabase request failed")
    }
    if (response.ok) return await response.json()
    const message = await readProviderMessage(response)
    if (response.status === 429) {
      throw new SupabaseManagementError("rate_limit", message, response.status, response.headers.get("retry-after"))
    }
    throw new SupabaseManagementError("provider", message, response.status)
  }
}
