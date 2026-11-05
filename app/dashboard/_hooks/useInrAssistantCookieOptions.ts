"use client";
import { useSyncExternalStore } from "react";
import { getInrAssistantCookieOptionsSnapshot, getInrAssistantCookieOptionsServerSnapshot, setNativeInrAssistantCookieOptions, subscribeInrAssistantCookieOptions } from "@/lib/inrAssistantCookieOptions";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

/** Call inside the authenticated dashboard. The banner itself is in root layout. */
export function useInrAssistantCookieOptions() {
  const snapshot = useSyncExternalStore(subscribeInrAssistantCookieOptions, getInrAssistantCookieOptionsSnapshot, getInrAssistantCookieOptionsServerSnapshot);
  useInrAssistantLocalInterface("cookie_options", snapshot, {
    open: { invoke: () => setNativeInrAssistantCookieOptions(true), matches: value => Boolean(value && typeof value === "object" && "available" in value && "open" in value && value.available === true && value.open === true) },
    close: { invoke: () => setNativeInrAssistantCookieOptions(false), matches: value => Boolean(value && typeof value === "object" && "available" in value && "open" in value && value.available === true && value.open === false) },
  }, snapshot.available);
}
