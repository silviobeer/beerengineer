"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DESIGN_PREP_STAGES,
  DESIGN_PREP_STAGE_LABELS,
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
  type BoardCardDTO,
} from "../lib/types";
import { MiniStepper } from "./MiniStepper";
import { BoardCardActions } from "./BoardCardActions";
import { ItemChat } from "./ItemChat";
import { ItemMessages } from "./ItemMessages";

interface BoardItemModalProps {
  card: BoardCardDTO;
  workspaceKey: string;
  onClose: () => void;
}

interface PreviewInfo {
  branch: string;
  worktreePath: string;
  previewHost: string;
  previewPort: number;
  previewUrl: string;
  running?: boolean;
  status?: "started" | "already_running" | "stopped";
  logPath?: string;
  launch?: {
    command: string;
    cwd: string;
    source: string;
  } | null;
}

export function BoardItemModal({ card, workspaceKey, onClose }: BoardItemModalProps) {
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const supportsPreviewControls =
    card.column === "merge" ||
    (card.column === "frontend" &&
      (card.current_stage === "visual-companion" || card.current_stage === "frontend-design"));

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the underlying board scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!supportsPreviewControls) return;
    let cancelled = false;
    setPreviewError(null);
    fetch(`/api/items/${encodeURIComponent(card.id)}/preview`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(body.error ?? `engine_${res.status}`);
        }
        return res.json() as Promise<PreviewInfo>;
      })
      .then((body) => {
        if (!cancelled) setPreview(body);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : "preview_lookup_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, supportsPreviewControls]);

  const fullPageHref = `/w/${encodeURIComponent(workspaceKey)}/items/${encodeURIComponent(card.id)}`;
  const itemBranch = `item/${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || card.id.toLowerCase()}`;
  const effectivePreviewUrl = preview?.previewUrl ?? card.previewUrl;
  const effectiveBranch = preview?.branch ?? itemBranch;

  const handleStartPreview = () => {
    setPreviewError(null);
    startPreviewTransition(async () => {
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(card.id)}/preview/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await res.json().catch(() => ({} as PreviewInfo & { error?: string }));
        if (!res.ok) {
          setPreviewError((body as { error?: string }).error ?? `engine_${res.status}`);
          return;
        }
        setPreview(body as PreviewInfo);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : "preview_start_failed");
      }
    });
  };

  return (
    <div
      data-testid="board-item-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={card.title || "Item detail"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
    >
      <div
        data-testid="board-item-modal-dialog"
        className="relative w-full max-w-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-zinc-800">
          <div className="flex flex-col gap-1 min-w-0">
            {card.itemCode ? (
              <span className="text-xs text-zinc-400 font-mono">{card.itemCode}</span>
            ) : null}
            <h2 className="text-lg font-semibold font-display tracking-tight break-words">
              {card.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="px-2 py-0.5 text-sm border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {card.summary ? (
            <p className="text-sm text-zinc-300">{card.summary}</p>
          ) : null}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-zinc-500">Column</dt>
            <dd className="text-zinc-200 font-mono">{card.column}</dd>
            <dt className="text-zinc-500">Phase</dt>
            <dd className="text-zinc-200 font-mono">{card.phase_status ?? "—"}</dd>
            <dt className="text-zinc-500">Stage</dt>
            <dd className="text-zinc-200 font-mono">{card.current_stage ?? "—"}</dd>
            <dt className="text-zinc-500">Item ID</dt>
            <dd className="text-zinc-400 font-mono break-all">{card.id}</dd>
            {card.column === "merge" ? (
              <>
                <dt className="text-zinc-500">Branch</dt>
                <dd className="text-zinc-200 font-mono break-all">{effectiveBranch}</dd>
                <dt className="text-zinc-500">Preview</dt>
                <dd className="text-zinc-200 font-mono break-all">
                  {effectivePreviewUrl ? (
                    <a href={effectivePreviewUrl} target="_blank" rel="noreferrer" className="underline text-zinc-200">
                      {effectivePreviewUrl}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </>
            ) : null}
          </dl>

          {card.column === "implementation" ? (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Implementation</div>
              <MiniStepper
                stage={card.current_stage}
                stages={IMPLEMENTATION_STAGES}
                labels={IMPLEMENTATION_STAGE_LABELS}
                ariaLabel="Implementation progress"
              />
            </div>
          ) : null}
          {card.column === "frontend" ? (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Design prep</div>
              <MiniStepper
                stage={card.current_stage}
                stages={DESIGN_PREP_STAGES}
                labels={DESIGN_PREP_STAGE_LABELS}
                ariaLabel="Design-prep progress"
              />
            </div>
          ) : null}
          {supportsPreviewControls ? (
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300 space-y-2">
              <div className="text-zinc-500 uppercase tracking-wider">Local Preview</div>
              <div className="font-mono">git checkout {effectiveBranch}</div>
              <div className="font-mono">
                {preview?.launch?.command ?? "configure preview.command or a root package.json dev script"}
              </div>
              {preview?.launch?.cwd ? (
                <div className="font-mono text-zinc-500">cwd: {preview.launch.cwd}</div>
              ) : null}
              {effectivePreviewUrl ? (
                <div className="font-mono">
                  {effectivePreviewUrl}
                  {preview?.status === "already_running" || preview?.running ? "  # running" : ""}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStartPreview}
                  disabled={isPreviewPending}
                  className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {preview?.running || preview?.status === "already_running" ? "Preview running" : "Start localhost"}
                </button>
                {effectivePreviewUrl ? (
                  <a
                    href={effectivePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  >
                    Open preview
                  </a>
                ) : null}
              </div>
              {preview?.logPath ? (
                <div className="font-mono text-zinc-500">log: {preview.logPath}</div>
              ) : null}
              {previewError ? (
                <div className="text-red-400">{previewError}</div>
              ) : null}
            </div>
          ) : null}
          {card.column === "merge" ? (
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300 space-y-1">
              <div className="text-zinc-500 uppercase tracking-wider">Promotion Gate</div>
              <div className="font-mono">git checkout {effectiveBranch}</div>
              <div className="font-mono">
                {preview?.launch?.command ?? "npm run dev"}
                {effectivePreviewUrl ? `  # ${effectivePreviewUrl}` : ""}
              </div>
            </div>
          ) : null}

          <BoardCardActions card={card} />

          <div className="pt-3 border-t border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Conversation
            </h3>
            <ItemChat itemId={card.id} />
          </div>

          <div className="pt-3 border-t border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Messages
            </h3>
            <ItemMessages itemId={card.id} />
          </div>

          <div className="pt-2 border-t border-zinc-800">
            <a
              href={fullPageHref}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Open full detail page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BoardItemModal;
