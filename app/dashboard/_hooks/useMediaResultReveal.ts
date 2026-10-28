"use client";

import { useEffect, useRef } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";

/** Reveal a newly completed attempt once; restoring or saving an existing result is not a new completion. */
export function useMediaResultReveal({
  accountId,
  running,
  resultId,
  resultAccountId,
}: {
  accountId?: string | null;
  running: boolean;
  resultId?: string | null;
  resultAccountId?: string | null;
}) {
  const reviewRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const attemptRef = useRef<{ accountId: string; previousResultId: string | null } | null>(null);

  useEffect(() => {
    if (!accountId || getActiveBrowserUserId() !== accountId) {
      attemptRef.current = null;
      return;
    }
    if (attemptRef.current?.accountId !== accountId) attemptRef.current = null;
    if (running) {
      attemptRef.current ??= { accountId, previousResultId: resultId || null };
      return;
    }
    const attempt = attemptRef.current;
    attemptRef.current = null;
    if (!attempt || !resultId || resultId === attempt.previousResultId || resultAccountId !== accountId) return;
    if (!window.matchMedia("(max-width: 1100px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      const review = reviewRef.current, heading = headingRef.current;
      if (getActiveBrowserUserId() !== accountId || document.visibilityState === "hidden" ||
        !review?.isConnected || !heading?.isConnected || !review.getClientRects().length ||
        review.closest('[hidden], [inert], [aria-hidden="true"]')) return;

      // A confirmation or another dialog keeps its focus even if a job finishes behind it.
      const focusedDialog = document.activeElement?.closest('dialog[open], [role="dialog"]');
      if (focusedDialog && !focusedDialog.contains(review)) return;

      const studio = review.closest("[data-inrcy-tool-dialog]");
      const header = studio?.querySelector<HTMLElement>(":scope > header");
      review.style.scrollMarginBlockStart = `${(header?.getBoundingClientRect().height || 0) + 12}px`;
      heading.focus({ preventScroll: true });
      review.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountId, running, resultId, resultAccountId]);

  return { reviewRef, headingRef };
}
