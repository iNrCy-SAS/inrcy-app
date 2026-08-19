"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import FinishEmailLinkClient from "@/app/auth/_components/FinishEmailLinkClient";

/**
 * Compatibility entry point for links issued by older Supabase templates.
 * The password is no longer written here: invitation, recovery and legacy
 * sessions all use the same audited server-side completion engine.
 */
function LegacySetPasswordBridge() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "reset" ? "reset" : "invite";
  const initialLanguage = searchParams.get("lang") || undefined;

  return (
    <FinishEmailLinkClient
      mode={mode}
      initialLanguage={initialLanguage}
      allowSessionFallback
    />
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <LegacySetPasswordBridge />
    </Suspense>
  );
}
