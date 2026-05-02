import { redirect } from "next/navigation";
import { fetchWorkspacesResult } from "@/lib/api";
import { fetchSetupReport } from "@/lib/setup/server";

/**
 * `/` is the board entry point. Redirects to the first registered
 * workspace's board. Falls back to a "no workspace" message when none
 * is registered or the engine is unreachable.
 */
export default async function HomePage() {
  const [workspaceResult, setupResult] = await Promise.all([fetchWorkspacesResult(), fetchSetupReport()]);
  const { workspaces, error } = workspaceResult;
  if (setupResult.data && setupResult.data.overall === "blocked") redirect("/setup");
  const first = workspaces[0]?.key;
  if (first) redirect(`/w/${encodeURIComponent(first)}`);
  if (!error) redirect("/setup");

  return (
    <main className="min-h-screen flex items-center justify-center p-8 text-zinc-100 bg-zinc-950">
      <div className="text-center space-y-2 max-w-md">
        <h1 className="text-2xl font-mono">No workspace</h1>
        <p className="text-sm text-zinc-400">
          {error
            ? "Engine is unreachable — start the API on port 4100, then open the setup URL again."
            : "No workspaces are registered. Run `beerengineer workspace add` to register one."}
        </p>
        <a className="text-sm text-amber-300 underline" href="/setup">
          Open setup
        </a>
      </div>
    </main>
  );
}
