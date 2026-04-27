import { redirect } from "next/navigation";
import { fetchWorkspacesResult } from "@/lib/api";

/**
 * `/` is the board entry point. Redirects to the first registered
 * workspace's board. Falls back to a "no workspace" message when none
 * is registered or the engine is unreachable.
 */
export default async function HomePage() {
  const { workspaces, error } = await fetchWorkspacesResult();
  const first = workspaces[0]?.key;
  if (first) redirect(`/w/${encodeURIComponent(first)}`);

  return (
    <main className="min-h-screen flex items-center justify-center p-8 text-zinc-100 bg-zinc-950">
      <div className="text-center space-y-2 max-w-md">
        <h1 className="text-2xl font-mono">No workspace</h1>
        <p className="text-sm text-zinc-400">
          {error
            ? "Engine is unreachable — start the API on port 4100."
            : "No workspaces are registered. Run `beerengineer workspace add` to register one."}
        </p>
      </div>
    </main>
  );
}
