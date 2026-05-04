export const SUPABASE_MANAGEMENT_API_BASE_URL = "https://api.supabase.com/v1"

export const managementEndpoints = {
  listProjects: "/projects",
  getProject: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}`,
  listBranches: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}/branches`,
  createBranch: (projectRef: string) => `/projects/${encodeURIComponent(projectRef)}/branches`,
  getBranch: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}`,
  deleteBranch: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}`,
  runQuery: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/query`,
  createAuthAdminUser: (projectRef: string, branchRef: string) =>
    `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}/auth/users`,
} as const

