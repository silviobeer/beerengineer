import { WorkspaceSettingsPage } from "@/components/settings/WorkspaceSettingsPage";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

function engineBaseUrl(): string {
  const url =
    process.env.BEERENGINEER_ENGINE_URL ||
    process.env.ENGINE_URL ||
    process.env.NEXT_PUBLIC_ENGINE_URL ||
    "http://127.0.0.1:4100";
  return url.replace(/\/$/, "");
}

async function fetchReadiness(key: string, runId?: string): Promise<SupabaseReadinessSnapshot> {
  try {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    const res = await fetch(`${engineBaseUrl()}/workspaces/${encodeURIComponent(key)}/supabase/readiness${query}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const body = await res.json() as { readiness?: SupabaseReadinessSnapshot };
    if (res.ok && body.readiness) return body.readiness;
  } catch {
    // The component renders the route key and an actionable error state.
  }
  return {
    status: "error",
    missingSetupActions: [],
    retry: { available: false },
    workspace: { key },
    message: "Engine Supabase readiness is unavailable.",
  };
}

export default async function WorkspaceSettingsRoute({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ key: string }>;
  searchParams?: Promise<{ runId?: string }>;
}>) {
  const { key } = await params;
  const query = await searchParams;
  const readiness = await fetchReadiness(key, query?.runId);
  return <WorkspaceSettingsPage workspaceKey={key} workspaceName={key} initialReadiness={readiness} />;
}
