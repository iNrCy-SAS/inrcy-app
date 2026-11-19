"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { evaluatePassword } from "@/lib/passwordPolicy";
import { createClient } from "@/lib/supabaseClient";
import styles from "./TemporaryPasswordWelcomeGate.module.css";

type Props = {
  actorUserId: string;
  temporaryPasswordWelcomeId: string | null;
  email: string;
  children: ReactNode;
};

/** The assistant's durable first-arrival claim starts only after this welcome. */
export default function TemporaryPasswordWelcomeGate(props: Props) {
  if (!props.temporaryPasswordWelcomeId) return <>{props.children}</>;
  return <TemporaryPasswordWelcomeScope key={`${props.actorUserId}:${props.temporaryPasswordWelcomeId}`} email={props.email}>{props.children}</TemporaryPasswordWelcomeScope>;
}

function TemporaryPasswordWelcomeScope({ email, children }: Pick<Props, "email" | "children">) {
  const t = useTranslations("auth.password");
  const [phase, setPhase] = useState<"checking" | "open" | "done">("checking");
  const [currentPassword, setCurrentPassword] = useState("");
  const [prefilledCurrent, setPrefilledCurrent] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeRef = useRef(true);
  const submittingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const checkRequestRef = useRef<Promise<unknown> | null>(null);
  const strength = evaluatePassword(password);

  useEffect(() => {
    activeRef.current = true;
    let cancelled = false;
    // The endpoint consumes its handoff cookie. Strict Mode subscribers must
    // observe the same request rather than consuming it a second time.
    if (!checkRequestRef.current) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      checkRequestRef.current = fetch("/api/auth/signup-access/password", {
        method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      }).then(async response => {
        if (!response.ok) throw new Error("password_welcome_unavailable");
        return await response.json() as unknown;
      }).catch(() => null).finally(() => window.clearTimeout(timeout));
    }
    void checkRequestRef.current.then(value => {
      if (cancelled) return;
      checkRequestRef.current = null;
      if (!value || typeof value !== "object" || !("required" in value) || typeof value.required !== "boolean") throw new Error("password_welcome_invalid");
      if (!value.required) { checkRequestRef.current = null; setPhase("done"); return; }
      if ("currentPassword" in value && typeof value.currentPassword === "string" && value.currentPassword.length > 0 && value.currentPassword.length <= 512) {
        setCurrentPassword(value.currentPassword);
        setPrefilledCurrent(true);
      }
      setPhase("open");
    }).catch(() => {
      // The authenticated server layout already confirmed a temporary password.
      // A handoff failure leaves a manual current-password field and Later.
      if (!cancelled) { checkRequestRef.current = null; setPhase("open"); }
    });
    return () => {
      cancelled = true;
      activeRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (phase !== "open" || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [phase]);

  function finish() {
    if (submittingRef.current) return;
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setError("");
    checkRequestRef.current = null;
    setPhase("done");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    if (!currentPassword) { setError(t("currentRequired")); return; }
    if (!strength.isAcceptable) { setError(t("tooWeak")); return; }
    if (password !== confirmation) { setError(t("mismatch")); return; }
    submittingRef.current = true;
    setBusy(true);
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, password }),
      });
      const result = await response.json();
      if (!activeRef.current) return;
      if (!response.ok || result?.ok !== true) {
        if (result?.code === "current_password_incorrect") { setPrefilledCurrent(false); setCurrentPassword(""); }
        setError(t(result?.code === "current_password_incorrect" ? "currentIncorrect" : result?.code === "same_password" ? "welcomeDifferent" : "updateFailed"));
        return;
      }
      // Clear the credential before either navigation or mounting normal onboarding.
      setCurrentPassword(""); setPassword(""); setConfirmation("");
      checkRequestRef.current = null;
      if (result.requires_login === true) {
        window.location.assign(`/login?email=${encodeURIComponent(email)}`);
        return;
      }
      await createClient().auth.getUser().catch(() => null);
      if (activeRef.current) setPhase("done");
    } catch {
      if (activeRef.current) setError(t("updateFailed"));
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
      submittingRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  if (phase === "done") return <>{children}</>;
  return <main className={styles.welcome}>
    {phase === "checking" ? <p className={styles.checking} role="status">{t("welcomeChecking")}</p> : null}
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="temporary-password-welcome-title" aria-describedby="temporary-password-welcome-description" onCancel={event => { event.preventDefault(); finish(); }}>
      <form className={styles.form} onSubmit={submit} aria-busy={busy}>
        <p className={styles.eyebrow}>iNrCy</p>
        <h1 id="temporary-password-welcome-title">{t("welcomeTitle")}</h1>
        <p id="temporary-password-welcome-description" className={styles.description}>{t("welcomeBody")}</p>
        <p className={styles.email}>{email}</p>
        {!prefilledCurrent ? <label className={styles.field}>
          <span>{t("welcomeCurrent")}</span>
          <input type="password" autoComplete="current-password" maxLength={512} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={busy} required />
        </label> : null}
        <label className={styles.field}>
          <span>{t("newPassword")}</span>
          <input name="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required />
        </label>
        <label className={styles.field}>
          <span>{t("confirmPassword")}</span>
          <input name="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required />
        </label>
        <label className={styles.show}><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} disabled={busy} />{t("showPassword")}</label>
        <ul className={styles.rules}>
          {([ ["minLen", "minLength"], ["hasLetter", "letter"], ["hasNumber", "number"], ["hasUpper", "uppercase"], ["hasSymbol", "symbol"] ] as const).map(([rule, label]) => <li key={rule} data-satisfied={strength.rules[rule]}><span aria-hidden="true">{strength.rules[rule] ? "✓" : "○"}</span>{t(label)}</li>)}
        </ul>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>{t(busy ? "saving" : "welcomeSave")}</button>
          <button className={styles.secondary} type="button" onClick={finish} disabled={busy}>{t("welcomeLater")}</button>
        </div>
      </form>
    </dialog>
  </main>;
}
