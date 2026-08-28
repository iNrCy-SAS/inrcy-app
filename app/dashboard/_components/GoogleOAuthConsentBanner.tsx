"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { GOOGLE_OAUTH_PERMISSION_ERROR_CODE } from "@/lib/googleOAuthConsent";

type Props = {
  panel: string | null;
};

const GOOGLE_PANELS = new Set([
  "gmb",
  "site_inrcy",
  "site_web",
  "mails",
  "youtube_shorts",
]);

function buildRetryHref(panel: string, linked: string | null): string | null {
  const returnTo = `/dashboard?panel=${panel}`;

  if (panel === "gmb") {
    return `/api/integrations/google-business/start?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (panel === "mails") {
    return `/api/integrations/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (panel === "youtube_shorts") {
    return `/api/integrations/youtube-shorts/start?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (
    (panel === "site_inrcy" || panel === "site_web") &&
    (linked === "ga4" || linked === "gsc")
  ) {
    const params = new URLSearchParams({
      source: panel,
      product: linked,
      returnTo,
    });
    return `/api/integrations/google-stats/start?${params.toString()}`;
  }
  return null;
}

export default function GoogleOAuthConsentBanner({ panel }: Props) {
  const i18nT = useTranslations("shell");
  const searchParams = useSearchParams();

  if (!panel || !GOOGLE_PANELS.has(panel)) return null;

  const error = searchParams.get("error");
  const linked = searchParams.get("linked");
  const permissionsIncomplete =
    error === GOOGLE_OAUTH_PERMISSION_ERROR_CODE || error === "access_denied";
  const retryHref = permissionsIncomplete ? buildRetryHref(panel, linked) : null;

  return (
    <div
      role={permissionsIncomplete ? "alert" : "note"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 12,
        padding: "11px 12px",
        borderRadius: 14,
        border: permissionsIncomplete
          ? "1px solid rgba(251, 191, 36, 0.55)"
          : "1px solid rgba(96, 165, 250, 0.30)",
        background: permissionsIncomplete
          ? "rgba(120, 53, 15, 0.28)"
          : "rgba(30, 64, 175, 0.16)",
        color: "rgba(255,255,255,0.92)",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <span style={{ flex: "1 1 320px" }}>
        {permissionsIncomplete
          ? i18nT("autorisations_google_incompletes_recommencez_et_cochez_8f39a6b1")
          : i18nT("important_sur_l_ecran_google_cochez_toutes_les_cases_57d2c18a")}
      </span>
      {retryHref ? (
        <button
          type="button"
          onClick={() => {
            window.location.href = retryHref;
          }}
          style={{
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 12,
            background: "rgba(251, 191, 36, 0.20)",
            color: "white",
            padding: "8px 11px",
            cursor: "pointer",
            fontWeight: 850,
          }}
        >
          {i18nT("recommencer_la_connexion_google_20e617ac")}
        </button>
      ) : null}
    </div>
  );
}
