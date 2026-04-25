export const OFFLINE_BANNER_TEXT =
  "[OFFLINE] Live-Updates pausiert — Seite neu laden zum wiederverbinden";

export function OfflineBanner() {
  return (
    <div
      data-testid="offline-banner"
      className="px-3 py-1 bg-[var(--color-bg-warn,#3a1a1a)] text-[var(--color-warn,#fa5)] font-mono text-xs border-b border-[var(--color-border,#333)]"
    >
      {OFFLINE_BANNER_TEXT}
    </div>
  );
}

export default OfflineBanner;
