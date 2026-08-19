"use client";

import { useTranslations } from "next-intl";

type Props = {
  busy?: boolean;
  previousDisabled?: boolean;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
};

export default function OnboardingStepFooter({
  busy = false,
  previousDisabled = false,
  onPrevious,
  onNext,
  onReset,
}: Props) {
  const t = useTranslations("dashboard.onboarding");

  return (
    <nav
      data-onboarding-step-footer
      aria-label={t("navigationLabel")}
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 12,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 10,
        padding: "22px 0 max(4px, env(safe-area-inset-bottom, 0px))",
        background:
          "linear-gradient(180deg, rgba(16,16,16,0), rgba(16,16,16,0.96) 30%, rgba(16,16,16,0.99))",
      }}
    >
      <button
        type="button"
        disabled={busy || previousDisabled}
        aria-disabled={busy || previousDisabled}
        onClick={() => void onPrevious()}
        style={{
          ...secondaryButtonStyle,
          opacity: previousDisabled ? 0.42 : busy ? 0.62 : 1,
          cursor: previousDisabled ? "not-allowed" : busy ? "wait" : "pointer",
        }}
      >
        <span aria-hidden="true">←</span>
        <span>{t("previous")}</span>
      </button>

      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void onNext()}
        style={{
          ...primaryButtonStyle,
          opacity: busy ? 0.7 : 1,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        <span>{busy ? t("saving") : t("next")}</span>
        {!busy ? <span aria-hidden="true">→</span> : null}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => void onReset()}
        style={{
          ...secondaryButtonStyle,
          opacity: busy ? 0.62 : 1,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        <span aria-hidden="true">↺</span>
        <span>{t("reset")}</span>
      </button>

      <style jsx>{`
        @media (max-width: 540px) {
          nav[data-onboarding-step-footer] {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }

          nav[data-onboarding-step-footer] button:last-of-type {
            grid-column: 1 / -1;
          }
        }
      `}</style>
    </nav>
  );
}

const sharedButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 46,
  borderRadius: 13,
  padding: "10px 12px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  color: "white",
  fontSize: 14,
  fontWeight: 900,
  lineHeight: 1.2,
};

const secondaryButtonStyle: React.CSSProperties = {
  ...sharedButtonStyle,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.055)",
};

const primaryButtonStyle: React.CSSProperties = {
  ...sharedButtonStyle,
  border: "1px solid rgba(125,211,252,0.42)",
  background:
    "linear-gradient(135deg, rgba(14,165,233,0.92), rgba(79,70,229,0.9), rgba(219,39,119,0.84))",
  boxShadow: "0 12px 30px rgba(14,165,233,0.2)",
};
