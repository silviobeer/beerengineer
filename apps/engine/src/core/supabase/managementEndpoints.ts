export const SUPABASE_MANAGEMENT_API_BASE_URL = "https://api.supabase.com/v1"

export const managementEndpoints = {
  listProjects: "/projects",
  getProject: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}`,
  listBranches: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}/branches`,
  createBranch: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}/branches`,
  getBranch: (_projectRef: string, branchRef: string) =>
    `/branches/${encodeURIComponent(branchRef)}`,
  deleteBranch: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}`,
  runQuery: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/query`,
  projectKeys: (projectRef: string, branchRef?: string) =>
    branchRef
      ? `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/api-keys`
      : `/projects/${encodeURIComponent(projectRef)}/api-keys`,
  branchConnectionString: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/connection-string`,
  createAuthAdminUser: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/auth/users`,
} as const
