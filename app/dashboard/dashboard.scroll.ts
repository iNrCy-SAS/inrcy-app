export const DASHBOARD_TOP_ANCHOR_ID = "dashboard-top";
export const DASHBOARD_TOOLS_ANCHOR_ID = "dashboard-main-tools";

const DASHBOARD_SCROLL_STORAGE_KEY = "inrcy_dashboard_scrollY";

function normalizeScrollTop(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function reducedMotionPreferred() {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function scrollToDashboardAnchor(anchorId: string) {
  if (typeof document === "undefined") return;
  document.getElementById(anchorId)?.scrollIntoView({
    behavior: reducedMotionPreferred() ? "auto" : "smooth",
    block: "start",
  });
}

export function readDashboardScrollPosition() {
  if (typeof window === "undefined") return null;
  try {
    const storedValue = sessionStorage.getItem(DASHBOARD_SCROLL_STORAGE_KEY);
    if (storedValue === null) return null;
    const parsedValue = Number.parseInt(storedValue, 10);
    return Number.isFinite(parsedValue) ? normalizeScrollTop(parsedValue) : null;
  } catch {
    return null;
  }
}

export function rememberDashboardScrollPosition(scrollTop = typeof window !== "undefined" ? window.scrollY : 0) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      DASHBOARD_SCROLL_STORAGE_KEY,
      String(normalizeScrollTop(scrollTop)),
    );
  } catch {}
}

/**
 * Restore after the dashboard has enough height to reach the saved position.
 * The former one-shot timeout could run before the channel carousel and tools
 * had finished laying out, so browsers clamped the scroll to the top.
 */
export function restoreDashboardScrollPosition() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const targetTop = readDashboardScrollPosition();
  if (targetTop === null) return () => undefined;

  let stopped = false;
  let frameId = 0;
  let timeoutId = 0;
  let resizeObserver: ResizeObserver | null = null;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (frameId) window.cancelAnimationFrame(frameId);
    if (timeoutId) window.clearTimeout(timeoutId);
    resizeObserver?.disconnect();
    window.removeEventListener("wheel", onUserInteraction);
    window.removeEventListener("touchstart", onUserInteraction);
    window.removeEventListener("pointerdown", onUserInteraction);
    window.removeEventListener("keydown", onUserInteraction);
  };

  const attemptRestore = () => {
    if (stopped) return;
    const root = document.documentElement;
    const maxTop = Math.max(0, root.scrollHeight - window.innerHeight);
    const reachableTop = Math.min(targetTop, maxTop);
    window.scrollTo({ top: reachableTop, left: 0, behavior: "auto" });

    if (maxTop >= targetTop - 2) {
      cleanup();
    }
  };

  function onUserInteraction() {
    cleanup();
  }

  window.addEventListener("wheel", onUserInteraction, { passive: true });
  window.addEventListener("touchstart", onUserInteraction, { passive: true });
  window.addEventListener("pointerdown", onUserInteraction, { passive: true });
  window.addEventListener("keydown", onUserInteraction);

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(attemptRestore);
    resizeObserver.observe(document.documentElement);
  }

  frameId = window.requestAnimationFrame(() => {
    frameId = window.requestAnimationFrame(attemptRestore);
  });
  timeoutId = window.setTimeout(() => {
    attemptRestore();
    cleanup();
  }, 1_800);

  return cleanup;
}
