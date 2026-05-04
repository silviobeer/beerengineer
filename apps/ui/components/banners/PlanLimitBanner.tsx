export function PlanLimitBanner({ ratio }: Readonly<{ ratio: number }>) {
  if (ratio < 0.8) return null;
  return (
    <div role="alert" className="border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
      <p className="font-medium">Supabase branch plan limit warning</p>
      <p>Branch quota usage is at {Math.floor(ratio * 100)}% of the plan limit.</p>
    </div>
  );
}
