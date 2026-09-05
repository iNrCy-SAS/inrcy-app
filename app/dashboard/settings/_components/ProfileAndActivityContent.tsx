"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { confirmInrcy } from "@/lib/inrcyDialog";
import ActivityContent, { type ActivityContentHandle } from "./ActivityContent";
import ProfilContent, { type ProfilContentHandle } from "./ProfilContent";

type Props = {
  initialSection?: "identity" | "activity" | null;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  onProfileSaved?: () => unknown | Promise<unknown>;
  onProfileReset?: () => unknown | Promise<unknown>;
  onActivitySaved?: () => unknown | Promise<unknown>;
  onActivityReset?: () => unknown | Promise<unknown>;
  onCloseDrawer?: () => unknown | Promise<unknown>;
  onOpenAiMemory: () => void;
};

export default function ProfileAndActivityContent({
  initialSection = null,
  onUnsavedChange,
  onProfileSaved,
  onProfileReset,
  onActivitySaved,
  onActivityReset,
  onCloseDrawer,
  onOpenAiMemory,
}: Props) {
  const t = useTranslations("dashboard.profilePanel");
  const profileRef = useRef<ProfilContentHandle | null>(null);
  const activityRef = useRef<ActivityContentHandle | null>(null);
  const identityBlockRef = useRef<HTMLDivElement | null>(null);
  const activityBlockRef = useRef<HTMLDivElement | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [activityDirty, setActivityDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    onUnsavedChange?.(profileDirty || activityDirty);
  }, [activityDirty, onUnsavedChange, profileDirty]);

  useEffect(() => {
    if (initialSection !== "activity") return;
    const timeout = window.setTimeout(() => {
      activityBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [initialSection]);

  const handleSaveAll = async () => {
    if (saving) return;
    const profile = profileRef.current;
    const activity = activityRef.current;
    if (!profile?.isReady() || !activity?.isReady()) return;

    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      const profileSaved = await profile.save();
      if (!profileSaved) {
        setSaveError(t("identityError"));
        identityBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const activitySaved = await activity.save();
      if (!activitySaved) {
        setSaveError(t("activityError"));
        activityBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      setProfileDirty(false);
      setActivityDirty(false);
      setSaved(true);
      if (onCloseDrawer) {
        window.setTimeout(() => {
          void onCloseDrawer();
        }, 850);
      } else {
        window.setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (saving) return;
    const confirmed = await confirmInrcy({
      title: t("resetTitle"),
      message: t("resetMessage"),
      confirmLabel: t("resetConfirm"),
      variant: "danger",
    });
    if (!confirmed) return;

    await Promise.all([
      profileRef.current?.reset({ confirm: false }),
      activityRef.current?.reset({ confirm: false }),
    ]);
    setProfileDirty(false);
    setActivityDirty(false);
    setSaved(false);
    setSaveError("");
    identityBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div data-combined-profile-panel style={panelStyle}>
      <section data-profile-block="general" style={grandBlockStyle}>
        <div ref={identityBlockRef} data-profile-segment="identity">
          <ProfilContent
            ref={profileRef}
            mode="page"
            showIntro={false}
            showActions={false}
            workspaceCompact
            onProfileSaved={onProfileSaved}
            onProfileReset={onProfileReset}
            onUnsavedChange={setProfileDirty}
          />
        </div>

        <div ref={activityBlockRef} data-profile-segment="activity" style={professionSegmentStyle}>
          <ActivityContent
            ref={activityRef}
            mode="page"
            contentScope="profile-core"
            showIntro={false}
            showActions={false}
            onActivitySaved={onActivitySaved}
            onActivityReset={onActivityReset}
            onUnsavedChange={setActivityDirty}
          />
        </div>
      </section>

      {saveError ? <div style={errorStyle}>{saveError}</div> : null}
      {saved ? <div style={successStyle}>{t("saved")}</div> : null}

      <div data-profile-workspace-footer style={profileFooterStyle}>
        <button type="button" onClick={onOpenAiMemory} style={memoryButtonStyle}>
          <span aria-hidden style={{ fontSize: 24 }}>🧬</span>
          <span style={{ display: "grid", gap: 2, minWidth: 0, textAlign: "left" }}>
            <strong style={{ fontSize: 13.5 }}>{t("memoryTitle")}</strong>
            <span style={{ color: "rgba(255,255,255,0.66)", fontSize: 11.5, lineHeight: 1.35 }}>
              {t("memoryDescription")}
            </span>
          </span>
          <span aria-hidden style={{ color: "#c4b5fd", fontSize: 20 }}>›</span>
        </button>

        <div data-combined-profile-actions style={actionsStyle}>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleResetAll()}
            style={secondaryButtonStyle}
          >
            {t("reset")}
          </button>
          <button
            type="button"
            disabled={saving}
            aria-busy={saving}
            onClick={() => void handleSaveAll()}
            style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 620px) {
          div[data-profile-workspace-footer] {
            grid-template-columns: 1fr !important;
          }
          div[data-combined-profile-actions] {
            grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr) !important;
          }
        }
      `}</style>
    </div>
  );
}

const panelStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  paddingBottom: "max(14px, var(--inrcy-safe-area-bottom))",
};

const grandBlockStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  padding: 15,
  borderRadius: 20,
  border: "1px solid rgba(125,211,252,0.18)",
  background: "linear-gradient(145deg, rgba(11,27,52,0.82), rgba(31,23,58,0.72))",
  boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
  scrollMarginTop: 12,
};

const professionSegmentStyle: CSSProperties = {
  paddingTop: 14,
  borderTop: "1px solid rgba(255,255,255,0.09)",
  scrollMarginTop: 76,
};

const actionsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(112px, .72fr) minmax(180px, 1.28fr)",
  gap: 9,
  alignSelf: "stretch",
};

const profileFooterStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.15fr) minmax(330px, .85fr)",
  alignItems: "stretch",
  gap: 10,
};

const memoryButtonStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 11,
  width: "100%",
  borderRadius: 16,
  border: "1px solid rgba(167,139,250,0.32)",
  background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(14,165,233,0.10))",
  color: "white",
  padding: "10px 12px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.13)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  padding: "11px 13px",
  cursor: "pointer",
  fontWeight: 800,
};

const primaryButtonStyle: CSSProperties = {
  borderRadius: 13,
  border: "1px solid rgba(125,211,252,0.34)",
  background: "linear-gradient(100deg, #0ea5e9, #7c3aed 55%, #ec4899)",
  color: "white",
  padding: "12px 15px",
  cursor: "pointer",
  fontWeight: 950,
  boxShadow: "0 12px 30px rgba(124,58,237,0.22)",
};

const errorStyle: CSSProperties = {
  padding: "11px 13px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.30)",
  background: "rgba(127,29,29,0.18)",
  color: "#fecaca",
  fontSize: 13,
  fontWeight: 800,
};

const successStyle: CSSProperties = {
  padding: "11px 13px",
  borderRadius: 12,
  border: "1px solid rgba(52,211,153,0.30)",
  background: "rgba(6,78,59,0.20)",
  color: "#a7f3d0",
  fontSize: 13,
  fontWeight: 850,
};
