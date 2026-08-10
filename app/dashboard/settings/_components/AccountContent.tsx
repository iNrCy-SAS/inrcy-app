"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
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

function formatSubscriptionDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function accountPlanPresentation(
  edition: DashboardEdition,
  subscription: AccountSubscriptionSummary | null,
) {
  const status = String(subscription?.status ?? "").trim().toLowerCase();
  const statusView =
    status === "trialing"
      ? { label: "Essai 21 jours", color: "#8feaff" }
      : status === "active"
        ? { label: "Actif", color: "#8ff7d0" }
        : status === "past_due" || status === "unpaid"
          ? { label: "À régulariser", color: "#ffd38f" }
          : status === "trial_expired"
            ? { label: "Essai terminé", color: "#ffbd8f" }
            : status === "canceled" || status === "cancelled"
              ? { label: "Résilié", color: "#ff9bbd" }
              : { label: "À vérifier", color: "#c8d3ef" };

  const label =
    edition === "standard"
      ? "iNrCy Standard"
      : edition === "founder"
        ? "iNrCy Founder"
        : "iNrCy Premium";
  const description =
    edition === "standard"
      ? "Booster sur 10 canaux, iNr’Agent Publications + Statistiques, iNr’Badge, iNr’Stats, historique iNr’Send et Réputation."
      : edition === "founder"
        ? "Partenaire fondateur : accès complet aux outils iNrCy actuels et futurs."
        : "Accès complet aux outils de pilotage et de développement de votre activité.";

  const trialEnd = formatSubscriptionDate(subscription?.trial_end_at);
  const renewal = formatSubscriptionDate(subscription?.next_renewal_date);
  const accessEnd = formatSubscriptionDate(subscription?.end_date);
  const detail =
    status === "trialing" && trialEnd
      ? `Fin de votre essai : ${trialEnd}`
      : subscription?.cancel_requested_at && accessEnd
        ? `Accès jusqu’au : ${accessEnd}`
        : renewal
          ? `Prochain renouvellement : ${renewal}`
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
            Number.isFinite(d.getTime()) ? d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }) : ""
          );
        }
      } catch (e: unknown) {
        setMsg(getSimpleFrenchErrorMessage(e, "Impossible de charger votre compte."));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const canSubmit = !busy && !!currentPassword && !!newPassword && newPassword === confirm && strength.isStrong;
  const planPresentation = useMemo(
    () => accountPlanPresentation(edition, subscriptionSummary),
    [edition, subscriptionSummary],
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
      setMsg("Veuillez saisir votre mot de passe actuel.");
      return;
    }
    if (!strength.isStrong) {
      setMsg("Mot de passe trop faible : 8+ caractères, lettre, chiffre, majuscule et symbole requis.");
      return;
    }
    if (newPassword !== confirm) {
      setMsg("Les deux mots de passe ne sont pas identiques.");
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
        setMsg("Mot de passe actuel incorrect.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setOk("✅ Mot de passe mis à jour.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: unknown) {
      setMsg(getSimpleFrenchErrorMessage(e, "Impossible de mettre à jour le mot de passe."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ opacity: 0.85 }}>Chargement…</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        {createdAt ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>Date de création</div>
            <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.92 }}>{createdAt}</div>
          </div>
        ) : null}

        <h2 style={{ margin: 0, fontSize: 16 }}>Identifiants</h2>
        <p style={{ margin: "8px 0 0", opacity: 0.8 }}>
          Votre email de connexion est affiché ci-dessous. Vous pouvez modifier votre mot de passe.
        </p>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div>
            <div style={label}>Mail</div>
            <input style={{ ...input, opacity: 0.9 }} value={email} readOnly />
          </div>


          <div>
            <div style={label}>Mot de passe actuel</div>
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
            <div style={label}>Nouveau mot de passe</div>
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
            <div style={label}>Confirmer le mot de passe</div>
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
            <Rule ok={strength.rules.minLen} label="8+ caractères" />
            <Rule ok={strength.rules.hasLetter} label="1 lettre" />
            <Rule ok={strength.rules.hasNumber} label="1 chiffre" />
            <Rule ok={strength.rules.hasUpper} label="1 majuscule" />
            <Rule ok={strength.rules.hasSymbol} label="1 symbole" />
          </div>

          <button type="button" onClick={onChangePassword} style={primaryBtn} disabled={!canSubmit}>
            Modifier le mot de passe
          </button>

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
              Votre forfait
            </div>
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
            ●&nbsp; {planPresentation.statusView.label}
          </div>
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
            Voir Mon abonnement →
          </button>
        ) : (
          <a href="/dashboard?panel=abonnement&panelSource=settings" style={planButton}>
            Voir Mon abonnement →
          </a>
        )}
      </div>
    </div>
  );
}
