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
  readonly card: BoardCardDTO;
  readonly workspaceKey: string;
  readonly onClose: () => void;
}

interface WireframesInfo {
  runId: string;
  screenMapUrl?: string;
  screens?: Array<{ id: string; name?: string; url?: string }>;
}

interface DesignInfo {
  runId: string;
  previewUrl?: string;
}

interface PreviewInfo {
  branch: string;
  worktreePath: string;
  previewHost: string;
  previewPort: number;
  previewUrl: string;
  running?: boolean;
  managed?: boolean;
  pid?: number | null;
  status?: "started" | "already_running" | "stopped" | "already_stopped";
  logPath?: string;
  launch?: {
    command: string;
    cwd: string;
    source: string;
  } | null;
}

async function fetchPreviewInfo(url: string, requestInit?: RequestInit): Promise<PreviewInfo> {
  const res = await fetch(url, requestInit);
  const body = await res.json().catch(() => ({} as PreviewInfo & { error?: string }));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `engine_${res.status}`);
  }
  return body as PreviewInfo;
}

async function fetchArtifactInfo<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({} as T & { error?: string }));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `engine_${res.status}`);
  }
  return body as T;
}

function supportsPreviewControlsForCard(card: BoardCardDTO): boolean {
  return card.column === "merge";
}

function supportsDesignArtifactsForCard(card: BoardCardDTO): boolean {
  return card.column === "frontend";
}

function itemBranchForCard(card: BoardCardDTO): string {
  return `item/${card.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || card.id.toLowerCase()}`;
}

function previewErrorMessageFor(previewError: string | null): string | null {
  if (previewError === "preview_running_but_unmanaged") {
    return "Preview is running but was not started by beerengineer_. Stop it manually in that worktree.";
  }
  return previewError;
}

function proxyArtifactHref(url: string | undefined): string | null {
  if (!url || !url.startsWith("/runs/")) return null;
  return `/api${url}`;
}

function usePreviewState(card: BoardCardDTO, supportsPreviewControls: boolean) {
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  useEffect(() => {
    if (!supportsPreviewControls) return;
    let cancelled = false;
    setPreviewError(null);
    fetchPreviewInfo(`/api/items/${encodeURIComponent(card.id)}/preview`, { cache: "no-store" })
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

  const runPreviewCommand = (path: "start" | "stop", fallbackError: string) => {
    setPreviewError(null);
    startPreviewTransition(async () => {
      try {
        setPreview(await fetchPreviewInfo(`/api/items/${encodeURIComponent(card.id)}/preview/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }));
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : fallbackError);
      }
    });
  };

  return {
    preview,
    previewError: previewErrorMessageFor(previewError),
    isPreviewPending,
    handleStartPreview: () => runPreviewCommand("start", "preview_start_failed"),
    handleStopPreview: () => runPreviewCommand("stop", "preview_stop_failed"),
  };
}

function useDesignArtifactState(card: BoardCardDTO, supportsDesignArtifacts: boolean) {
  const [wireframes, setWireframes] = useState<WireframesInfo | null>(null);
  const [design, setDesign] = useState<DesignInfo | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    if (!supportsDesignArtifacts) return;
    let cancelled = false;
    setArtifactError(null);
    setWireframes(null);
    setDesign(null);

    Promise.all([
      fetchArtifactInfo<WireframesInfo>(`/api/items/${encodeURIComponent(card.id)}/wireframes`),
      fetchArtifactInfo<DesignInfo>(`/api/items/${encodeURIComponent(card.id)}/design`),
    ])
      .then(([wireframesBody, designBody]) => {
        if (cancelled) return;
        setWireframes(wireframesBody);
        setDesign(designBody);
      })
      .catch((err) => {
        if (!cancelled) {
          setArtifactError(err instanceof Error ? err.message : "artifact_lookup_failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [card.id, supportsDesignArtifacts]);

  return { wireframes, design, artifactError };
}

function StageProgress({ card }: Readonly<{ card: BoardCardDTO }>) {
  if (card.column === "implementation") {
    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1">Implementation</div>
        <MiniStepper
          stage={card.current_stage}
          stages={IMPLEMENTATION_STAGES}
          labels={IMPLEMENTATION_STAGE_LABELS}
          ariaLabel="Implementation progress"
        />
      </div>
    );
  }
  if (card.column !== "frontend") return null;
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1">Design prep</div>
      <MiniStepper
        stage={card.current_stage}
        stages={DESIGN_PREP_STAGES}
        labels={DESIGN_PREP_STAGE_LABELS}
        ariaLabel="Design-prep progress"
      />
    </div>
  );
}

function PreviewMetadata({
  card,
  effectiveBranch,
  effectivePreviewUrl,
}: Readonly<{
  card: BoardCardDTO;
  effectiveBranch: string;
  effectivePreviewUrl: string | undefined;
}>) {
  if (card.column !== "merge") return null;
  return (
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
  );
}

function LocalPreviewPanel({
  preview,
  effectiveBranch,
  effectivePreviewUrl,
  isPreviewLive,
  isPreviewPending,
  previewErrorMessage,
  onTogglePreview,
}: Readonly<{
  preview: PreviewInfo | null;
  effectiveBranch: string;
  effectivePreviewUrl: string | undefined;
  isPreviewLive: boolean;
  isPreviewPending: boolean;
  previewErrorMessage: string | null;
  onTogglePreview: () => void;
}>) {
  return (
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
          {isPreviewLive ? "  # running" : ""}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTogglePreview}
          disabled={isPreviewPending}
          className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isPreviewLive ? "Stop localhost" : "Start localhost"}
        </button>
        {effectivePreviewUrl && isPreviewLive ? (
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
      {previewErrorMessage ? (
        <div className="text-red-400">{previewErrorMessage}</div>
      ) : null}
    </div>
  );
}

function DesignArtifactsPanel({
  card,
  wireframes,
  design,
  artifactError,
}: Readonly<{
  card: BoardCardDTO;
  wireframes: WireframesInfo | null;
  design: DesignInfo | null;
  artifactError: string | null;
}>) {
  const screenMapHref = proxyArtifactHref(wireframes?.screenMapUrl);
  const designPreviewHref = proxyArtifactHref(design?.previewUrl);
  const screenLinks = (wireframes?.screens ?? [])
    .map((screen) => ({
      id: screen.id,
      label: screen.name ?? screen.id,
      href: proxyArtifactHref(screen.url),
    }))
    .filter((screen): screen is { id: string; label: string; href: string } => Boolean(screen.href));
  const hasArtifacts = Boolean(screenMapHref || designPreviewHref || screenLinks.length > 0);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300 space-y-2">
      <div className="text-zinc-500 uppercase tracking-wider">
        {card.current_stage === "frontend-design" ? "Design Review" : "Wireframe Review"}
      </div>
      {screenMapHref ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={screenMapHref}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            Open screen map
          </a>
          {screenLinks.slice(0, 3).map((screen) => (
            <a
              key={screen.id}
              href={screen.href}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
            >
              {screen.label}
            </a>
          ))}
        </div>
      ) : null}
      {designPreviewHref ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={designPreviewHref}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            Open design preview
          </a>
        </div>
      ) : null}
      {!hasArtifacts ? (
        <div className="text-zinc-500">
          {card.current_stage === "frontend-design"
            ? "Artifacts will appear here as visual-companion and frontend-design finish."
            : "Wireframe artifacts will appear here when visual-companion completes."}
        </div>
      ) : null}
      {artifactError ? (
        <div className="text-red-400">{artifactError}</div>
      ) : null}
    </div>
  );
}

function ActiveArtifactPreview({
  card,
  wireframes,
  design,
}: Readonly<{
  card: BoardCardDTO;
  wireframes: WireframesInfo | null;
  design: DesignInfo | null;
}>) {
  const screenMapHref = proxyArtifactHref(wireframes?.screenMapUrl);
  const designPreviewHref = proxyArtifactHref(design?.previewUrl);
  const previewHref =
    card.current_stage === "frontend-design"
      ? (designPreviewHref ?? screenMapHref)
      : screenMapHref;

  if (!previewHref) return null;

  return (
    <div className="border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">
          Review Surface
        </h3>
        <a
          href={previewHref}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] uppercase tracking-wider text-zinc-300 underline"
        >
          Open in new tab
        </a>
      </div>
      <iframe
        title={card.current_stage === "frontend-design" ? "Design preview" : "Wireframe preview"}
        src={previewHref}
        className="h-[28rem] w-full border border-zinc-800 bg-white"
      />
    </div>
  );
}

function PromotionGatePanel({
  preview,
  effectiveBranch,
  effectivePreviewUrl,
}: Readonly<{
  preview: PreviewInfo | null;
  effectiveBranch: string;
  effectivePreviewUrl: string | undefined;
}>) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300 space-y-1">
      <div className="text-zinc-500 uppercase tracking-wider">Promotion Gate</div>
      <div className="font-mono">git checkout {effectiveBranch}</div>
      <div className="font-mono">
        {preview?.launch?.command ?? "npm run dev"}
        {effectivePreviewUrl ? `  # ${effectivePreviewUrl}` : ""}
      </div>
    </div>
  );
}

export function BoardItemModal({ card, workspaceKey, onClose }: Readonly<BoardItemModalProps>) {
  const supportsPreviewControls = supportsPreviewControlsForCard(card);
  const supportsDesignArtifacts = supportsDesignArtifactsForCard(card);
  const { preview, previewError, isPreviewPending, handleStartPreview, handleStopPreview } = usePreviewState(card, supportsPreviewControls);
  const { wireframes, design, artifactError } = useDesignArtifactState(card, supportsDesignArtifacts);

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the underlying board scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const fullPageHref = `/w/${encodeURIComponent(workspaceKey)}/items/${encodeURIComponent(card.id)}`;
  const itemBranch = itemBranchForCard(card);
  const effectivePreviewUrl = preview?.previewUrl ?? card.previewUrl;
  const effectiveBranch = preview?.branch ?? itemBranch;
  const isPreviewLive = preview?.running || preview?.status === "already_running";

  return (
    <dialog
      data-testid="board-item-modal-backdrop"
      open
      aria-modal="true"
      aria-label={card.title || "Item detail"}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
    >
      <div
        data-testid="board-item-modal-dialog"
        className="relative flex max-h-[88vh] w-[80vw] max-w-[80vw] flex-col overflow-hidden bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl"
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

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="min-w-0 min-h-0 overflow-y-auto border border-zinc-800 bg-zinc-950/40 p-3">
            <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
              Conversation
            </h3>
            <ItemChat itemId={card.id} />
          </section>

          <section className="min-w-0 min-h-0 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-3 border border-zinc-800 bg-zinc-950/40 p-3">
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
                <PreviewMetadata
                  card={card}
                  effectiveBranch={effectiveBranch}
                  effectivePreviewUrl={effectivePreviewUrl}
                />
              </dl>

              <StageProgress card={card} />
              {supportsDesignArtifacts ? (
                <DesignArtifactsPanel
                  card={card}
                  wireframes={wireframes}
                  design={design}
                  artifactError={artifactError}
                />
              ) : null}
              {supportsPreviewControls ? (
                <LocalPreviewPanel
                  preview={preview}
                  effectiveBranch={effectiveBranch}
                  effectivePreviewUrl={effectivePreviewUrl}
                  isPreviewLive={isPreviewLive}
                  isPreviewPending={isPreviewPending}
                  previewErrorMessage={previewError}
                  onTogglePreview={isPreviewLive ? handleStopPreview : handleStartPreview}
                />
              ) : null}
              {card.column === "merge" ? (
                <PromotionGatePanel
                  preview={preview}
                  effectiveBranch={effectiveBranch}
                  effectivePreviewUrl={effectivePreviewUrl}
                />
              ) : null}

              <BoardCardActions card={card} />
            </div>

            {supportsDesignArtifacts ? (
              <ActiveArtifactPreview
                card={card}
                wireframes={wireframes}
                design={design}
              />
            ) : null}

            <div className="border border-zinc-800 bg-zinc-950/40 p-3">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
                Messages
              </h3>
              <ItemMessages itemId={card.id} />
            </div>

            <div className="border-t border-zinc-800 pt-2">
              <a
                href={fullPageHref}
                className="text-xs text-zinc-400 hover:text-zinc-200 underline"
              >
                Open full detail page
              </a>
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );
}

export default BoardItemModal;
