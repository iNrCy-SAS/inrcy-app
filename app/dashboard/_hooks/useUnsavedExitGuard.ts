"use client";

import { useCallback, useEffect, useRef } from "react";
import { confirmInrcy, type InrcyDialogVariant } from "@/lib/inrcyDialog";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";

type UseUnsavedExitGuardOptions = {
  active: boolean;
  shouldBlock: boolean;
  onConfirmExit: () => void | Promise<void>;
  /**
   * Optionally resolves a blocked exit before navigation. This is useful for
   * workspaces that can save their draft automatically instead of forcing the
   * person to choose between editing and losing data.
   */
  onBlockedExit?: () => boolean | Promise<boolean>;
  title?: string;
  message?: string;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: InrcyDialogVariant;
};

const DEFAULT_TITLE = "Quitter sans sauvegarder ?";
const DEFAULT_MESSAGE =
  "Vous avez des modifications en cours. Si vous quittez maintenant, elles seront perdues.";
const DEFAULT_CONFIRM_LABEL = "Quitter";
const DEFAULT_CANCEL_LABEL = "Continuer l’édition";

function makeGuardId() {
  return `inrcy-exit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useUnsavedExitGuard({
  active,
  shouldBlock,
  onConfirmExit,
  onBlockedExit,
  title = DEFAULT_TITLE,
  message = DEFAULT_MESSAGE,
  eyebrow,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  cancelLabel = DEFAULT_CANCEL_LABEL,
  variant = "warning",
}: UseUnsavedExitGuardOptions) {
  const { registerGuard } = useDashboardUnsavedNavigation();
  const onConfirmExitRef = useRef(onConfirmExit);
  const onBlockedExitRef = useRef(onBlockedExit);
  const shouldBlockRef = useRef(shouldBlock);
  const confirmingRef = useRef(false);
  const guardIdRef = useRef<string>(makeGuardId());
  const guardUrlRef = useRef<string>("");

  useEffect(() => {
    onConfirmExitRef.current = onConfirmExit;
  }, [onConfirmExit]);

  useEffect(() => {
    onBlockedExitRef.current = onBlockedExit;
  }, [onBlockedExit]);

  useEffect(() => {
    shouldBlockRef.current = shouldBlock;
  }, [shouldBlock]);

  const confirmExit = useCallback(async () => {
    if (!shouldBlockRef.current) {
      await onConfirmExitRef.current();
      return true;
    }

    if (confirmingRef.current) return false;
    confirmingRef.current = true;
    try {
      const resolveBlockedExit = onBlockedExitRef.current;
      if (resolveBlockedExit) {
        const canExit = await resolveBlockedExit();
        if (!canExit) return false;
        await onConfirmExitRef.current();
        return true;
      }

      const ok = await confirmInrcy({
        eyebrow,
        title,
        message,
        confirmLabel,
        cancelLabel,
        variant,
      });
      if (ok) {
        await onConfirmExitRef.current();
        return true;
      }
      return false;
    } finally {
      confirmingRef.current = false;
    }
  }, [cancelLabel, confirmLabel, eyebrow, message, title, variant]);

  useEffect(() => {
    if (!active) return;
    return registerGuard({
      id: guardIdRef.current,
      shouldBlock: () => shouldBlockRef.current,
      confirmExit,
    });
  }, [active, confirmExit, registerGuard]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    const guardId = guardIdRef.current;
    const guardUrl = window.location.href;
    guardUrlRef.current = guardUrl;

    try {
      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
      if (currentState?.__inrcyExitGuard !== guardId) {
        window.history.pushState({ ...currentState, __inrcyExitGuard: guardId }, "", guardUrl);
      }
    } catch {
      // History API can fail in some embedded browsers. beforeunload still protects refresh/close.
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const onPopState = () => {
      if (!active) return;

      const currentUrl = guardUrlRef.current || window.location.href;
      try {
        const currentState = window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {};
        window.history.pushState({ ...currentState, __inrcyExitGuard: guardId }, "", currentUrl);
      } catch {}

      void confirmExit();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [active, confirmExit]);

  return { confirmExit };
}
