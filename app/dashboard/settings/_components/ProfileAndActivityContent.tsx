"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { confirmInrcy } from "@/lib/inrcyDialog";
import ActivityContent, { type ActivityContentHandle } from "./ActivityContent";
import ProfilContent, { type ProfilContentHandle } from "./ProfilContent";

type Props = {
  initialSection?: "identity" | "activity" | null;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  onProfileSaved: () => unknown | Promise<unknown>;
  onProfileReset: () => unknown | Promise<unknown>;
  onActivitySaved: () => unknown | Promise<unknown>;
  onActivityReset: () => unknown | Promise<unknown>;
  onCloseDrawer: () => unknown | Promise<unknown>;
};

export default function ProfileAndActivityContent({
  initialSection = null,
  onUnsavedChange,
  onProfileSaved,
  onProfileReset,
  onActivitySaved,
  onActivityReset,
  onCloseDrawer,
}: Props) {
  const t = useTranslations("dashboard.profilePanel");
  const profileRef = useRef<ProfilContentHandle | null>(null);
  const activityRef = useRef<ActivityContentHandle | null>(null);
  const identityBlockRef = useRef<HTMLElement | null>(null);
  const activityBlockRef = useRef<HTMLElement | null>(null);
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
      window.setTimeout(() => {
        void onCloseDrawer();
      }, 850);
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
      <section ref={identityBlockRef} data-profile-block="identity" style={grandBlockStyle}>
        <BlockHeader
          number="1"
          title={t("identityTitle")}
          description={t("identityDescription")}
        />
        <ProfilContent
          ref={profileRef}
          mode="page"
          showIntro={false}
          showActions={false}
          onProfileSaved={onProfileSaved}
          onProfileReset={onProfileReset}
          onUnsavedChange={setProfileDirty}
        />
      </section>

      <section ref={activityBlockRef} data-profile-block="activity" style={grandBlockStyle}>
        <BlockHeader
          number="2"
          title={t("activityTitle")}
          description={t("activityDescription")}
        />
        <ActivityContent
          ref={activityRef}
          mode="page"
          showIntro={false}
          showActions={false}
          onActivitySaved={onActivitySaved}
          onActivityReset={onActivityReset}
          onUnsavedChange={setActivityDirty}
        />
      </section>

      {saveError ? <div style={errorStyle}>{saveError}</div> : null}
      {saved ? <div style={successStyle}>{t("saved")}</div> : null}

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

      <style jsx>{`
        @media (max-width: 620px) {
          div[data-combined-profile-actions] {
            grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr) !important;
          }
        }
      `}</style>
    </div>
  );
}

function BlockHeader({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <header style={blockHeaderStyle}>
      <span aria-hidden="true" style={blockNumberStyle}>{number}</span>
      <div style={{ minWidth: 0 }}>
        <h3 style={blockTitleStyle}>{title}</h3>
        <p style={blockDescriptionStyle}>{description}</p>
      </div>
    </header>
  );
}

const panelStyle: CSSProperties = {
  display: "grid",
  gap: 18,
  paddingBottom: "max(24px, var(--inrcy-safe-area-bottom))",
};

const grandBlockStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  padding: 14,
  borderRadius: 20,
  border: "1px solid rgba(125,211,252,0.18)",
  background: "linear-gradient(145deg, rgba(11,27,52,0.82), rgba(31,23,58,0.72))",
  boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
  scrollMarginTop: 12,
};

const blockHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  paddingBottom: 12,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
};

const blockNumberStyle: CSSProperties = {
  width: 34,
  height: 34,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  borderRadius: 999,
  border: "1px solid rgba(56,189,248,0.38)",
  background: "rgba(56,189,248,0.14)",
  color: "#bae6fd",
  fontWeight: 950,
};

const blockTitleStyle: CSSProperties = {
  margin: 0,
  color: "white",
  fontSize: 17,
  fontWeight: 950,
};

const blockDescriptionStyle: CSSProperties = {
  margin: "3px 0 0",
  color: "rgba(255,255,255,0.64)",
  fontSize: 12,
  lineHeight: 1.4,
};

const actionsStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 9,
  display: "grid",
  gridTemplateColumns: "auto minmax(190px, 1fr)",
  gap: 10,
  padding: "14px 0 max(4px, var(--inrcy-safe-area-bottom))",
  background: "linear-gradient(180deg, rgba(6,16,31,0), rgba(6,16,31,0.98) 30%)",
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
