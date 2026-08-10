"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import StandardSubscriptionContent from "./StandardSubscriptionContent";

type Props = {
  mode?: "page" | "drawer";
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  edition?: DashboardEdition;
  onRequestPremium?: () => void;
};

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
  onRequestPremium,
}: Props) {
  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
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
        setEmail(data.user?.email || "");
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
      {edition === "standard" ? (
        <StandardSubscriptionContent onOpenContact={onRequestPremium ?? (() => {})} />
      ) : null}
    </div>
  );
}
