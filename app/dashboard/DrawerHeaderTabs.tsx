"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./DrawerHeaderTabs.module.css";

/** Undefined means a standalone page; null waits for the drawer's header ref. */
export const DrawerHeaderTabsContext = createContext<HTMLElement | null | undefined>(undefined);

export default function DrawerHeaderTabs({ children }: { children: ReactNode }) {
  const host = useContext(DrawerHeaderTabsContext);
  if (host === undefined) return <>{children}</>;
  if (!host) return null;
  return createPortal(<div className={styles.portaled} data-drawer-header-tabs>{children}</div>, host);
}
