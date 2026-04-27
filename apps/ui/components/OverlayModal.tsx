"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface OverlayModalProps {
  children: ReactNode;
  /**
   * aria-label for the modal dialog. The intercepting-route page should
   * pass something descriptive (e.g. the item title or code).
   */
  ariaLabel?: string;
}

/**
 * Modal shell rendered by the intercepting `@modal/(.)items/[id]` route.
 * Closes on backdrop click, ESC, or back-button. Closing calls
 * `router.back()` so the URL returns to `/w/[key]` without a full reload.
 */
export function OverlayModal({ children, ariaLabel = "Item detail" }: OverlayModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = (): void => {
    router.back();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // close is stable for the lifetime of this mount (router from hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock the underlying board from scrolling while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      data-testid="overlay-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={dialogRef}
        data-testid="overlay-dialog"
        className="relative w-full max-w-5xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl"
      >
        <button
          type="button"
          data-testid="overlay-close"
          onClick={close}
          aria-label="Close"
          className="absolute top-2 right-2 z-10 px-2 py-0.5 text-sm border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

export default OverlayModal;
