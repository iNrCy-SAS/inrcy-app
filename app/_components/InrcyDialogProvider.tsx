"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../dashboard/dashboard.module.css";
import { INRCY_DIALOG_EVENT, type InrcyDialogRequest } from "@/lib/inrcyDialog";

type DialogState = InrcyDialogRequest;

function splitMessage(message: string): string[] {
  return String(message || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getDialogCopy(dialog: DialogState, i18nT: (_key: string) => string) {
  const isPrompt = dialog.type === "prompt";
  const isAlert = dialog.type === "alert";
  const variant = dialog.options.variant || "warning";

  return {
    eyebrow: dialog.options.eyebrow || (variant === "danger" ? i18nT("action_sensible_d1f29317") : i18nT("confirmation_3424edc2")),
    title: dialog.options.title || (isPrompt ? i18nT("saisir_une_information_41c060f6") : i18nT("confirmer_l_action_d1682c9c")),
    confirmLabel: dialog.options.confirmLabel || (isPrompt ? i18nT("valider_be4220f7") : isAlert ? i18nT("continuer_129ffff9") : variant === "danger" ? i18nT("confirmer_80a664c8") : i18nT("continuer_129ffff9")),
    cancelLabel: dialog.options.cancelLabel || i18nT("annuler_49ba3292"),
    variant,
  };
}

export default function InrcyDialogProvider() {
  const i18nT = useTranslations("shell");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const queueRef = useRef<DialogState[]>([]);
  const activeRef = useRef<DialogState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openNext = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift() || null;
    if (!next) return;
    activeRef.current = next;
    setPromptValue(next.type === "prompt" ? next.options.defaultValue || "" : "");
    setPromptError("");
    setDialog(next);
  }, []);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const customEvent = event as CustomEvent<DialogState>;
      if (!customEvent.detail) return;
      queueRef.current.push(customEvent.detail);
      openNext();
    };

    window.addEventListener(INRCY_DIALOG_EVENT, onRequest);
    return () => window.removeEventListener(INRCY_DIALOG_EVENT, onRequest);
  }, [openNext]);

  useEffect(() => {
    activeRef.current = dialog;
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const bodyStyle = body.style as CSSStyleDeclaration & { overscrollBehavior?: string };
    const prevBodyTouchAction = bodyStyle.touchAction;
    const prevBodyOverscroll = bodyStyle.overscrollBehavior;

    html.style.overflow = "hidden";
    bodyStyle.overflow = "hidden";
    bodyStyle.touchAction = "none";
    bodyStyle.overscrollBehavior = "none";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
      if (event.key === "Enter" && dialog.type !== "prompt") {
        event.preventDefault();
        finish(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    window.setTimeout(() => {
      if (dialog.type === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }, 40);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      html.style.overflow = prevHtmlOverflow;
      bodyStyle.overflow = prevBodyOverflow;
      bodyStyle.touchAction = prevBodyTouchAction;
      bodyStyle.overscrollBehavior = prevBodyOverscroll;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const finish = useCallback(
    (value: boolean | string | null) => {
      const current = activeRef.current;
      if (!current) return;

      if (current.type === "confirm") {
        current.resolve(Boolean(value));
      } else if (current.type === "alert") {
        current.resolve();
      } else {
        current.resolve(typeof value === "string" ? value : null);
      }

      activeRef.current = null;
      setDialog(null);
      setPromptValue("");
      setPromptError("");
      window.setTimeout(openNext, 0);
    },
    [openNext],
  );

  if (!dialog) return null;

  const copy = getDialogCopy(dialog, i18nT);
  const lines = splitMessage(dialog.options.message);
  const isDanger = copy.variant === "danger";

  const submitPrompt = () => {
    const value = promptValue.trim();
    if (dialog.type === "prompt" && dialog.options.required !== false && !value) {
      setPromptError(i18nT("ce_champ_est_obligatoire_95840ee3"));
      return;
    }
    finish(value);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="inrcy-dialog-title" style={overlayStyle} onMouseDown={() => finish(null)}>
      <div className={styles.blockCard} style={cardStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={glowStyle} />
        <div style={headerStyle}>
          <span style={pillStyle}>{copy.eyebrow}</span>
          <button type="button" className={styles.ghostBtn} style={closeStyle} onClick={() => finish(null)} aria-label={i18nT("fermer_5ab4ec64")}>
            ×
          </button>
        </div>

        <div style={iconWrapStyle}>
          <span style={{ ...iconStyle, ...(isDanger ? dangerIconStyle : warningIconStyle) }}>{isDanger ? "!" : "✓"}</span>
        </div>

        <h2 id="inrcy-dialog-title" style={titleStyle}>{copy.title}</h2>

        <div style={messageWrapStyle}>
          {lines.length ? lines.map((line, index) => <p key={`${line}-${index}`} style={messageStyle}>{line}</p>) : null}
        </div>

        {dialog.type === "prompt" ? (
          <div style={fieldWrapStyle}>
            <input
              ref={inputRef}
              value={promptValue}
              placeholder={dialog.options.placeholder || "Nom"}
              onChange={(event) => {
                setPromptValue(event.target.value);
                if (promptError) setPromptError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
              style={inputStyle}
            />
            {promptError ? <p style={errorStyle}>{promptError}</p> : null}
          </div>
        ) : null}

        <div style={actionsStyle}>
          {dialog.type !== "alert" ? (
            <button type="button" className={styles.secondaryBtn} style={buttonStyle} onClick={() => finish(null)}>
              {copy.cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ ...buttonStyle, ...(isDanger ? dangerButtonStyle : null) }}
            onClick={() => (dialog.type === "prompt" ? submitPrompt() : finish(true))}
          >
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  // The dialog is mounted at the app root and must stay above every drawer,
  // modal and mobile overlay opened by a feature below it.
  zIndex: 2147483646,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  boxSizing: "border-box",
  overflowX: "hidden",
  overflowY: "auto",
  background: "rgba(2, 6, 23, 0.68)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

const cardStyle: CSSProperties = {
  width: "min(680px, calc(100vw - 24px))",
  maxWidth: "100%",
  margin: "auto",
  flex: "0 0 auto",
  boxSizing: "border-box",
  position: "relative",
  minWidth: 0,
  overflow: "hidden",
  padding: 20,
  borderRadius: 24,
  background: "linear-gradient(180deg, rgba(30, 41, 72, 0.96), rgba(15, 23, 42, 0.96))",
  border: "1px solid rgba(255,255,255,0.16)",
  boxShadow: "0 28px 100px rgba(0,0,0,0.55)",
};

const glowStyle: CSSProperties = {
  position: "absolute",
  inset: "-90px -90px auto auto",
  width: 220,
  height: 220,
  borderRadius: 999,
  background: "radial-gradient(circle, rgba(167, 139, 250, 0.28), rgba(56, 189, 248, 0.10), transparent 70%)",
  pointerEvents: "none",
};

const headerStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 11px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.78)",
  fontSize: 12,
  fontWeight: 850,
};

const closeStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  padding: 0,
  fontSize: 20,
  lineHeight: 1,
};

const iconWrapStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  marginTop: 4,
};

const iconStyle: CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  fontSize: 24,
  border: "1px solid rgba(255,255,255,0.16)",
};

const warningIconStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(167, 139, 250, 0.18))",
  color: "rgba(255,255,255,0.94)",
};

const dangerIconStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(248, 113, 113, 0.24), rgba(244, 114, 182, 0.18))",
  color: "rgba(255,255,255,0.96)",
};

const titleStyle: CSSProperties = {
  position: "relative",
  margin: "14px 0 8px",
  textAlign: "center",
  color: "rgba(255,255,255,0.96)",
  fontSize: 22,
  lineHeight: 1.15,
  letterSpacing: "-0.03em",
  fontWeight: 950,
};

const messageWrapStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gap: 6,
  margin: "0 auto",
  maxWidth: 420,
};

const messageStyle: CSSProperties = {
  margin: 0,
  textAlign: "center",
  color: "rgba(255,255,255,0.72)",
  fontSize: 13,
  lineHeight: 1.45,
};

const fieldWrapStyle: CSSProperties = {
  marginTop: 16,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.94)",
  outline: "none",
  padding: "12px 14px",
  fontSize: 14,
  fontWeight: 750,
};

const errorStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "rgba(252, 165, 165, 0.95)",
  fontSize: 12,
  fontWeight: 800,
};

const actionsStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  gap: 10,
  marginTop: 20,
  minWidth: 0,
};

const buttonStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 44,
  borderRadius: 14,
  fontSize: 13,
  overflowWrap: "anywhere",
};

const dangerButtonStyle: CSSProperties = {
  borderColor: "rgba(248, 113, 113, 0.36)",
  background: "linear-gradient(90deg, rgba(248, 113, 113, 0.20), rgba(244, 114, 182, 0.16))",
};
