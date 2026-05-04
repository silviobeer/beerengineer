export function RetainedBranchBanner({ count, deepLinkHref }: Readonly<{ count: number; deepLinkHref: string }>) {
  if (count <= 0) return null;
  return (
    <div role="alert" className="border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
      <p className="font-medium">Retained Supabase branches: {count}</p>
      <p>Provider cost risk remains while retained branches exist.</p>
      <a className="text-amber-200 underline" href={deepLinkHref}>Open diagnosis and cleanup</a>
    </div>
  );
}
