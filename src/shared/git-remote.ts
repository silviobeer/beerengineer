export type GitRemoteRepository = {
  organization: string;
  repository: string;
};

export function parseGitRemoteRepository(remoteUrl: string | null): GitRemoteRepository | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const sshMatch = trimmed.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch && !sshMatch[2].includes("/")) {
    return normalizeGitRemoteRepository(sshMatch[1], sshMatch[2]);
  }

  try {
    const parsed = new URL(trimmed);
    const pathSegments = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
    if (pathSegments.length === 2) {
      return normalizeGitRemoteRepository(pathSegments[0], pathSegments[1]);
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeGitRemoteRepository(organization: string, repository: string): GitRemoteRepository | null {
  const normalizedOrganization = organization.trim();
  const normalizedRepository = repository.trim();
  if (!normalizedOrganization || !normalizedRepository) {
    return null;
  }
  return {
    organization: normalizedOrganization,
    repository: normalizedRepository
  };
}
