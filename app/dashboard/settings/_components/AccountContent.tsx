"use client";

import { useLocale, useTranslations } from "next-intl";


import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import type { DashboardEdition } from "@/lib/dashboardEdition";

type Props = {
  mode?: "page" | "drawer";
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  edition?: DashboardEdition;
  onOpenSubscription?: () => void;
};

type AccountSubscriptionSummary = {
  status?: string | null;
  trial_end_at?: string | null;
  next_renewal_date?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
};

function formatSubscriptionDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function accountPlanPresentation(
  edition: DashboardEdition,
  subscription: AccountSubscriptionSummary | null,
  i18nT: (key: string) => string,
  locale: string,
) {
  const status = String(subscription?.status ?? "").trim().toLowerCase();
  const statusView =
    status === "trialing"
      ? { label: i18nT("essai_21_jours_3095df3f"), color: "#8feaff" }
      : status === "active"
        ? { label: i18nT("actif_2eb75f84"), color: "#8ff7d0" }
        : status === "past_due" || status === "unpaid"
          ? { label: i18nT("a_regulariser_7046f900"), color: "#ffd38f" }
          : status === "trial_expired"
            ? { label: i18nT("essai_termine_be984f1c"), color: "#ffbd8f" }
            : status === "canceled" || status === "cancelled"
              ? { label: i18nT("resilie_1ca48fe3"), color: "#ff9bbd" }
              : { label: i18nT("a_verifier_8f5f7255"), color: "#c8d3ef" };

  const label =
    edition === "standard"
      ? i18nT("inrcy_standard_1dd18060")
      : edition === "founder"
        ? "iNrCy Founder"
        : i18nT("inrcy_premium_4c7d39c1");
  const description =
    edition === "standard"
      ? i18nT("booster_sur_10_canaux_inr_apos_38a43414")
      : edition === "founder"
        ? i18nT("passez_du_pilotage_de_votre_visibilite_37fbfe56")
        : i18nT("passez_du_pilotage_de_votre_visibilite_37fbfe56");

  const trialEnd = formatSubscriptionDate(subscription?.trial_end_at, locale);
  const renewal = formatSubscriptionDate(subscription?.next_renewal_date, locale);
  const accessEnd = formatSubscriptionDate(subscription?.end_date, locale);
  const detail =
    status === "trialing" && trialEnd
      ? `${i18nT("fin_de_votre_essai_f1bae9e9")} ${trialEnd}`
      : subscription?.cancel_requested_at && accessEnd
        ? `${i18nT("votre_acces_restera_actif_jusqu_au_1da564dd")} ${accessEnd}`
        : renewal
          ? `${i18nT("renouvellement_annuel_ffcc422c")}: ${renewal}`
          : null;

  return { label, description, detail, statusView };
}

function getPasswordStrength(pw: string) {
  const rules = {
    minLen: pw.length >= 8,
    hasLetter: /[a-zA-Z]/.test(pw),
    hasNumber: /\d/.test(pw),
    hasUpper: /[A-Z]/.test(pw),
    hasSymbol: /[^a-zA-Z0-9]/.test(pw),
  };
  const score = Object.values(rules).filter(Boolean).length; // 0..5
  const isStrong = score === 5;
  return { rules, score, isStrong };
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", opacity: ok ? 1 : 0.75 }}>
      <span aria-hidden style={{ fontSize: 12 }}>{ok ? "●" : "○"}</span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

export default function AccountContent({
  mode: _mode = "page",
  onUnsavedChange,
  edition = "premium",
  onOpenSubscription,
}: Props) {
  const i18nT = useTranslations("settings");
  const passwordT = useTranslations("auth.password");
  const locale = useLocale();
  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [subscriptionSummary, setSubscriptionSummary] = useState<AccountSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [ok, setOk] = useState<string>("");

  useEffect(() => {
    onUnsavedChange?.(Boolean(currentPassword || newPassword || confirm));
  }, [confirm, currentPassword, newPassword, onUnsavedChange]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      setOk("");
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw new Error(error.message);
        const user = data.user;
        setEmail(user?.email || "");
        if (user) {
          const { data: subscriptionData } = await supabase
            .from("subscriptions")
            .select("status,trial_end_at,next_renewal_date,cancel_requested_at,end_date")
            .eq("user_id", user.id)
            .maybeSingle();
          setSubscriptionSummary((subscriptionData as AccountSubscriptionSummary | null) ?? null);
        }
        const raw = (data.user as any)?.created_at as string | undefined;
        if (raw) {
          const d = new Date(raw);
          setCreatedAt(
            Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) : ""
          );
        }
      } catch (e: unknown) {
        console.error(e);
        setMsg(passwordT("accountLoadFailed"));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [locale, passwordT]);

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const canSubmit = !busy && !!currentPassword && !!newPassword && newPassword === confirm && strength.isStrong;
  const planPresentation = useMemo(
    () => accountPlanPresentation(edition, subscriptionSummary, i18nT, locale),
    [edition, subscriptionSummary, i18nT, locale],
  );

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    color: "white",
    padding: "10px 12px",
    outline: "none",
  };

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 900, opacity: 0.85, marginBottom: 6 };

  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.35), rgba(97, 87, 255, 0.28), rgba(0, 200, 255, 0.22))",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    width: "100%",
    opacity: busy ? 0.7 : 1,
  };

  const planButton: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(115deg, rgba(39, 154, 255, .9), rgba(133, 74, 239, .92), rgba(238, 72, 163, .82))",
    color: "white",
    borderRadius: 14,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 900,
    width: "100%",
    display: "block",
    textAlign: "center",
    textDecoration: "none",
    marginTop: 14,
  };


  async function onChangePassword() {
    setMsg("");
    setOk("");
    if (!currentPassword) {
      setMsg(passwordT("currentRequired"));
      return;
    }
    if (!strength.isStrong) {
      setMsg(passwordT("tooWeak"));
      return;
    }
    if (newPassword !== confirm) {
      setMsg(passwordT("mismatch"));
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();

      // 🔐 Vérifier le mot de passe actuel (ré-auth)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        const signInFailure = `${String(signInError.code || "")} ${signInError.message}`.toLowerCase();
        if (signInFailure.includes("invalid_credentials") || signInFailure.includes("invalid login credentials")) {
          setMsg(passwordT("currentIncorrect"));
          return;
        }
        throw signInError;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        // Une réponse réseau peut être perdue après l’écriture. Vérifier le
        // résultat rend le changement idempotent au lieu d’afficher un faux
        // échec alors que le nouveau mot de passe est déjà actif.
        const verification = await supabase.auth.signInWithPassword({
          email,
          password: newPassword,
        });
        if (verification.error) throw updateError;
      }

      setOk(passwordT("updateSuccess"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: unknown) {
      console.error(e);
      setMsg(passwordT("updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ opacity: 0.85 }}>{i18nT("chargement_01cba1df")}</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        {createdAt ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>{i18nT("date_de_creation_d5e8d1af")}</div>
            <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.92 }}>{createdAt}</div>
          </div>
        ) : null}

        <h2 style={{ margin: 0, fontSize: 16 }}>{i18nT("identifiants_7e7dc904")}</h2>
        <p style={{ margin: "8px 0 0", opacity: 0.8 }}>
          {i18nT("votre_email_de_connexion_est_affiche_84123fc4")}{" "}</p>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div>
            <div style={label}>{i18nT("mail_92379cbb")}</div>
            <input style={{ ...input, opacity: 0.9 }} value={email} readOnly />
          </div>


          <div>
            <div style={label}>{i18nT("mot_de_passe_actuel_f9242976")}</div>
            <input
              style={input}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <div>
            <div style={label}>{i18nT("nouveau_mot_de_passe_3a713829")}</div>
            <input
              style={input}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>

          <div>
            <div style={label}>{i18nT("confirmer_le_mot_de_passe_88362d0d")}</div>
            <input
              style={input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: "grid", gap: 6, opacity: 0.9 }}>
            <Rule ok={strength.rules.minLen} label={i18nT("8_caracteres_85066a4b")} />
            <Rule ok={strength.rules.hasLetter} label={i18nT("1_lettre_2147bd0b")} />
            <Rule ok={strength.rules.hasNumber} label={i18nT("1_chiffre_6d6bd070")} />
            <Rule ok={strength.rules.hasUpper} label={i18nT("1_majuscule_6f8fac24")} />
            <Rule ok={strength.rules.hasSymbol} label={i18nT("1_symbole_412b784c")} />
          </div>

          <button type="button" onClick={onChangePassword} style={primaryBtn} disabled={!canSubmit}>
            {i18nT("modifier_le_mot_de_passe_b6eec6a6")}{" "}</button>

          {msg ? <div style={{ marginTop: 6, opacity: 0.9 }}>⚠️ {msg}</div> : null}
          {ok ? <div style={{ marginTop: 6, opacity: 0.95 }}>{ok}</div> : null}
        </div>
      </div>
      <div
        style={{
          ...card,
          border: "1px solid rgba(69, 205, 255, 0.28)",
          background:
            "linear-gradient(135deg, rgba(33, 132, 190, 0.16), rgba(98, 72, 191, 0.12), rgba(255,255,255,0.035))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.82, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {i18nT("votre_forfait_6d06f631")}{" "}</div>
            <div style={{ marginTop: 6, fontSize: 24, lineHeight: 1.15, fontWeight: 900 }}>
              {planPresentation.label}
            </div>
          </div>
          <div
            style={{
              flexShrink: 0,
              border: `1px solid ${planPresentation.statusView.color}55`,
              background: `${planPresentation.statusView.color}16`,
              color: planPresentation.statusView.color,
              borderRadius: 999,
              padding: "7px 11px",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            {i18nT("nbsp_value_34e8a717", { value0: planPresentation.statusView.label })}</div>
        </div>
        <p style={{ margin: "14px 0 0", opacity: 0.84, lineHeight: 1.5 }}>
          {planPresentation.description}
        </p>
        {planPresentation.detail ? (
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 800, opacity: 0.92 }}>
            {planPresentation.detail}
          </div>
        ) : null}
        {onOpenSubscription ? (
          <button type="button" onClick={onOpenSubscription} style={planButton}>
            {i18nT("voir_mon_abonnement_d5b2da25")}{" "}</button>
        ) : (
          <a href="/dashboard?panel=abonnement&panelSource=settings" style={planButton}>
            {i18nT("voir_mon_abonnement_d5b2da25")}{" "}</a>
        )}
      </div>
    </div>
  );
}
