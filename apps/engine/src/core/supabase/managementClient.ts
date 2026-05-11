import { managementEndpoints, SUPABASE_MANAGEMENT_API_BASE_URL } from "./managementEndpoints.js"
import type { SupabaseBranch, SupabaseProject, SupabaseSqlResult } from "./types.js"

export type SupabaseManagementClientOptions = {
  token: string
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

export class SupabaseManagementError extends Error {
  constructor(
    public readonly kind: "provider" | "rate_limit" | "network" | "timeout",
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

function normalizeBranch(value: unknown): SupabaseBranch {
  const branch = value as SupabaseBranch
  return {
    ...branch,
    ref: branch.ref ?? branch.id,
  }
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
  private readonly timeoutMs: number

  constructor(private readonly options: SupabaseManagementClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.baseUrl = (options.baseUrl ?? SUPABASE_MANAGEMENT_API_BASE_URL).replace(/\/$/, "")
    this.timeoutMs = options.timeoutMs ?? 8_000
  }

  async listProjects(): Promise<SupabaseProject[]> {
    return asArray<SupabaseProject>(await this.request(managementEndpoints.listProjects))
  }

  async getProject(projectRef: string): Promise<SupabaseProject> {
    return await this.request(managementEndpoints.getProject(projectRef)) as SupabaseProject
  }

  async listBranches(projectRef: string): Promise<SupabaseBranch[]> {
    return asArray<unknown>(await this.request(managementEndpoints.listBranches(projectRef))).map(normalizeBranch)
  }

  async createBranch(projectRef: string, input: { name: string; parentRef?: string }): Promise<SupabaseBranch> {
    // QA-021: createBranch occasionally takes >8s on the Supabase side
    // (provisioning a database). Override the global timeout for this
    // single call so we don't spuriously fail-fast and orphan a branch
    // that's actually in-flight.
    return normalizeBranch(await this.request(managementEndpoints.createBranch(projectRef), {
      method: "POST",
      body: JSON.stringify({
        branch_name: input.name,
        parent_ref: input.parentRef,
      }),
    }, { timeoutMs: 30_000 }))
  }

  async getBranch(projectRef: string, branchRef: string): Promise<SupabaseBranch> {
    return normalizeBranch(await this.request(managementEndpoints.getBranch(projectRef, branchRef)))
  }

  async deleteBranch(projectRef: string, branchRef: string): Promise<void> {
    await this.request(managementEndpoints.deleteBranch(projectRef, branchRef), { method: "DELETE" })
  }

  async runQuery(projectRef: string, branchRef: string, sql: string): Promise<SupabaseSqlResult> {
    return await this.request(managementEndpoints.runQuery(projectRef, branchRef), {
      method: "POST",
      body: JSON.stringify({ query: sql }),
    }) as SupabaseSqlResult
  }

  async getProjectKeys(projectRef: string, branchRef?: string): Promise<{ anonKey: string; serviceRoleKey: string; url: string }> {
    const body = await this.request(managementEndpoints.projectKeys(projectRef, branchRef)) as {
      anonKey?: string
      anon_key?: string
      serviceRoleKey?: string
      service_role_key?: string
      url?: string
    }
    return {
      anonKey: body.anonKey ?? body.anon_key ?? "",
      serviceRoleKey: body.serviceRoleKey ?? body.service_role_key ?? "",
      url: body.url ?? `https://${projectRef}.supabase.co`,
    }
  }

  async getBranchConnectionString(projectRef: string, branchRef: string): Promise<string> {
    const body = await this.request(managementEndpoints.branchConnectionString(projectRef, branchRef)) as { connectionString?: string; connection_string?: string }
    return body.connectionString ?? body.connection_string ?? ""
  }

  private async request(path: string, init: RequestInit = {}, options: { timeoutMs?: number } = {}): Promise<unknown> {
    let response: Response
    const controller = new AbortController()
    const effectiveTimeoutMs = options.timeoutMs ?? this.timeoutMs
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs)
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new SupabaseManagementError("timeout", `Supabase Management API request timed out after ${effectiveTimeoutMs}ms`)
      }
      throw new SupabaseManagementError("network", err instanceof Error ? err.message : "Supabase request failed")
    } finally {
      clearTimeout(timeout)
    }
    if (response.ok) {
      if (response.status === 204) return {}
      return await response.json()
    }
    const message = await readProviderMessage(response)
    if (response.status === 429) {
      throw new SupabaseManagementError("rate_limit", message, response.status, response.headers.get("retry-after"))
    }
    throw new SupabaseManagementError("provider", message, response.status)
  }
}
