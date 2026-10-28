"use client";

import { createContext, useContext, useEffect, useId } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantClientScreen } from "@/lib/inrAssistantClientContext";

type ScreenHint = Omit<InrAssistantClientScreen, "pathname" | "tool">;
type RegisterScreen = (id: string, value: (ScreenHint & { pathname: string }) | null) => void;
export const DashboardAssistantScreenContext = createContext<RegisterScreen>(() => {});

/** An explicit application state, never a DOM scrape or a grant of permission. */
export function useInrAssistantScreen(value: ScreenHint | null) {
  const register = useContext(DashboardAssistantScreenContext);
  const id = useId();
  const pathname = usePathname();
  const serialized = value === null ? null : JSON.stringify({ ...value, pathname });
  useEffect(() => {
    if (!serialized) return;
    register(id, JSON.parse(serialized));
    return () => register(id, null);
  }, [id, pathname, register, serialized]);
}
