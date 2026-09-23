"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clearInrStudioHandoff,
  readInrStudioHandoff,
  type InrStudioHandoff,
  type InrStudioReturnedMedia,
} from "@/lib/inrStudioNavigation";
import { captureInrStudioViewport } from "@/lib/inrStudioViewport";

const Studio = dynamic(() => import("@/app/dashboard/generer-media/MediaGeneratorStudioClient"), { ssr: false });

/** Share the full Studio without navigating away from an editor or losing its state. */
export function useInrStudioSession({ onReturned, onClosed }: {
  onReturned: (result: InrStudioReturnedMedia) => void;
  onClosed?: () => void;
}) {
  const [session, setSession] = useState<InrStudioHandoff | null>(null);
  const sessionRef = useRef<InrStudioHandoff | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);
  const pendingReturnRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onReturned, onClosed });
  useLayoutEffect(() => { callbacks.current = { onReturned, onClosed }; });

  const openStudio = useCallback((href: string) => {
    if (sessionRef.current) return;
    const key = new URL(href, window.location.origin).searchParams.get("studio_handoff");
    const handoff = readInrStudioHandoff(key);
    if (!handoff) throw new Error("La session iNrStudio n’est plus disponible. Réessayez.");
    restoreRef.current = captureInrStudioViewport();
    sessionRef.current = handoff;
    setSession(handoff);
  }, []);

  const closeStudio = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    callbacks.current.onClosed?.();
  }, []);

  const receiveMedia = useCallback((result: InrStudioReturnedMedia) => {
    return new Promise<void>((resolve, reject) => {
      pendingReturnRef.current = resolve;
      try {
        callbacks.current.onReturned(result);
      } catch (error) {
        pendingReturnRef.current = null;
        reject(error);
      }
    });
  }, []);

  // The origin acknowledges only once the replacement/insertion is finished.
  const completeReturn = useCallback(() => {
    const resolve = pendingReturnRef.current;
    pendingReturnRef.current = null;
    resolve?.();
  }, []);

  useLayoutEffect(() => {
    if (session || !restoreRef.current) return;
    restoreRef.current();
    restoreRef.current = null;
  }, [session]);

  useEffect(() => () => {
    if (sessionRef.current) void clearInrStudioHandoff(sessionRef.current.key);
    pendingReturnRef.current?.();
  }, []);

  return {
    openStudio,
    completeReturn,
    studio: session ? <Studio key={session.key} embeddedHandoff={session} onEmbeddedReturn={receiveMedia} onEmbeddedClose={closeStudio} /> : null,
  };
}
