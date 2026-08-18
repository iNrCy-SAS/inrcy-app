"use client";

import { useTranslations } from "next-intl";

type Props = {
  onCustomize: () => void;
  onKeepDefaults: () => void | Promise<void>;
  busy?: boolean;
};

export default function DashboardOnboardingAiChoice({
  onCustomize,
  onKeepDefaults,
  busy = false,
}: Props) {
  const t = useTranslations("dashboard.onboarding");

  return (
    <section
      aria-labelledby="dashboard-onboarding-ai-choice-title"
      style={{
        minHeight: "min(620px, calc(100svh - 150px))",
        display: "grid",
        alignContent: "center",
        justifyItems: "center",
        padding: "32px 0 48px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "min(100%, 620px)",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 22,
          padding: "clamp(24px, 5vw, 42px)",
          boxSizing: "border-box",
          textAlign: "center",
          background:
            "radial-gradient(circle at 50% 0%, rgba(56,189,248,.13), transparent 38%), rgba(255,255,255,.035)",
          boxShadow: "0 24px 70px rgba(0,0,0,.28)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 20px",
            borderRadius: 20,
            display: "grid",
            placeItems: "center",
            fontSize: 31,
            background: "linear-gradient(135deg, rgba(56,189,248,.22), rgba(236,72,153,.22))",
            border: "1px solid rgba(255,255,255,.11)",
          }}
        >
          ✦
        </div>
        <h3
          id="dashboard-onboarding-ai-choice-title"
          style={{ margin: 0, color: "white", fontSize: "clamp(22px, 4vw, 30px)", lineHeight: 1.15 }}
        >
          {t("aiReadyTitle")}
        </h3>
        <p
          style={{
            margin: "14px auto 0",
            maxWidth: 520,
            color: "rgba(255,255,255,.7)",
            fontSize: 15,
            lineHeight: 1.65,
          }}
        >
          {t("aiReadyDescription")}
        </p>

        <div
          style={{
            marginTop: 28,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={onCustomize}
            disabled={busy}
            style={{
              minHeight: 48,
              border: "1px solid rgba(56,189,248,.45)",
              borderRadius: 13,
              padding: "12px 16px",
              color: "white",
              fontWeight: 800,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.65 : 1,
              background: "linear-gradient(135deg, rgba(14,165,233,.88), rgba(59,130,246,.84))",
            }}
          >
            {t("customizeAi")}
          </button>
          <button
            type="button"
            onClick={() => void onKeepDefaults()}
            disabled={busy}
            style={{
              minHeight: 48,
              border: "1px solid rgba(255,255,255,.14)",
              borderRadius: 13,
              padding: "12px 16px",
              color: "white",
              fontWeight: 800,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.65 : 1,
              background: "rgba(255,255,255,.055)",
            }}
          >
            {t("keepDefaults")}
          </button>
        </div>
      </div>
    </section>
  );
}
