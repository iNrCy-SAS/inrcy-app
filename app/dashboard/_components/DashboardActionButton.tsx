"use client";

import { useTranslations } from "next-intl";


import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import styles from "../dashboard.module.css";
import type { ModuleAction } from "../dashboard.types";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";

type DashboardActionButtonProps = {
  action: ModuleAction;
  className?: string;
};

type SearchParamsReader = { get: (name: string) => string | null };

function internalHrefIsActive(href: string, pathname: string, searchParams: SearchParamsReader) {
  const target = new URL(href, "https://inrcy.local");
  if (pathname !== target.pathname) return false;

  for (const [key, value] of target.searchParams.entries()) {
    if (searchParams.get(key) !== value) return false;
  }

  return true;
}

export default function DashboardActionButton({ action, className }: DashboardActionButtonProps) {
  const i18nT = useTranslations("shell");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    pendingKey,
    beginAction,
    completeAction,
    isVisible,
  } = useDelayedPendingAction<string>();
  const resolvedClassName = className || (
    action.variant === "connect"
      ? `${styles.actionBtn} ${styles.connectBtn}`
      : action.variant === "danger"
        ? `${styles.actionBtn} ${styles.actionDanger}`
        : `${styles.actionBtn} ${styles.actionView}`
  );

  const internalHref = action.href?.startsWith("/") ? action.href : null;
  const actionKey = internalHref ? `navigate:${internalHref}` : null;
  const pending = Boolean(actionKey && pendingKey === actionKey);
  const loadingVisible = Boolean(actionKey && isVisible(actionKey));

  useEffect(() => {
    if (!actionKey || !internalHref || pendingKey !== actionKey) return;
    if (internalHrefIsActive(internalHref, pathname, searchParams)) {
      completeAction(actionKey);
    }
  }, [actionKey, completeAction, internalHref, pathname, pendingKey, searchParams]);

  if (action.href) {
    const isExternal = action.href.startsWith("http");

    return (
      <Link
        href={action.href}
        className={resolvedClassName}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        data-dashboard-prefetch={internalHref || undefined}
        aria-busy={loadingVisible || undefined}
        aria-disabled={loadingVisible || undefined}
        onClick={(event) => {
          if (!internalHref || !actionKey) return;
          if (!beginAction(actionKey)) {
            event.preventDefault();
            return;
          }
          requestDashboardToolWarmup(internalHref);
        }}
      >
        {loadingVisible ? i18nT("chargement_01cba1df") : action.label}
      </Link>
    );
  }

  return (
    <button type="button" className={resolvedClassName} onClick={action.onClick} disabled={action.disabled}>
      {action.label}
    </button>
  );
}
