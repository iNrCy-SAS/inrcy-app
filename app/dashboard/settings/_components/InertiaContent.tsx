"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import type { InertiaSnapshot } from "@/lib/loyalty/inertia";

type Props = {
  mode?: "drawer" | "page";
  edition?: DashboardEdition;
  snapshot: InertiaSnapshot;
  onOpenBoutique?: () => void;
};

type LoyaltyEvent = {
  id: string;
  created_at: string;
  action_key: string;
  label: string | null;
  amount: number;
};

const PREMIUM_INERTIA_ACTION_KEYS = new Set([
  "weekly_feature_use",
  "weekly_propulser_use",
  "weekly_fideliser_use",
]);

export default function InertiaContent({ edition = "premium", snapshot, onOpenBoutique }: Props) {
  const i18nT = useTranslations("settings");
  const [uiBalance, setUiBalance] = useState<number>(0);
  const [events, setEvents] = useState<LoyaltyEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [supabaseReady, setSupabaseReady] = useState<boolean>(true);

  // ⚠️ Prévu Supabase :
  // - loyalty_balance (user_id, balance)
  // - loyalty_ledger (id, user_id, action_key, source_id, amount, label, meta, created_at)
  //
  // Tant que les tables n'existent pas, on ne casse rien.

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const supabase = createClient();
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          if (!mounted) return;
          setLoading(false);
          return;
        }

        // Déclenche une réparation légère des missions hebdo si une campagne/publication
        // a été envoyée mais que le crédit UI n'a pas encore été inscrit.
        await fetch("/api/loyalty/weekly-summary", { cache: "no-store" }).catch(() => null);

        const balanceRes = await supabase
          .from("loyalty_balance")
          .select("balance")
          .eq("user_id", resolveActiveBrowserUserId(user.id))
          .maybeSingle();

        // Si table absente -> erreur -> fallback silencieux
        if ((balanceRes as any)?.error) throw (balanceRes as any).error;

        const balance = Number((balanceRes.data as any)?.balance ?? 0);

        const eventsRes = await supabase
          .from("loyalty_ledger")
          .select("id,created_at,action_key,label,amount")
          .eq("user_id", resolveActiveBrowserUserId(user.id))
          .order("created_at", { ascending: false })
          .limit(20);

        if ((eventsRes as any)?.error) throw (eventsRes as any).error;

        if (!mounted) return;
        setUiBalance(balance);
        setEvents((eventsRes.data as any) ?? []);
        setLoading(false);
      } catch {
        if (!mounted) return;
        setSupabaseReady(false);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const weekStart = useMemo(() => {
    // Lundi 00:00 (ISO-ish) en local
    const now = new Date();
    const d = new Date(now);
    const day = d.getDay(); // 0=dim
    const diff = (day === 0 ? -6 : 1) - day; // vers lundi
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const boosts = useMemo(() => {
    const inWeek = (e: LoyaltyEvent) => new Date(e.created_at) >= weekStart;
    const didActu = events.some((e) => inWeek(e) && e.action_key === "create_actu");
    const didPropulser = events.some((e) => inWeek(e) && e.action_key === "weekly_propulser_use");
    const didFideliser = events.some((e) => inWeek(e) && e.action_key === "weekly_fideliser_use");
    return [
      {
        key: "create_actu",
        title: i18nT("utiliser_booster_6138c57d"),
        subtitle: i18nT("10_ui_1_publication_semaine_64ed20db"),
        done: didActu,
      },
      {
        key: "weekly_propulser_use",
        title: i18nT("utiliser_propulser_c4b4b56d"),
        subtitle: i18nT("10_ui_1_action_semaine_8dafdd90"),
        done: didPropulser,
        premiumOnly: edition === "standard",
      },
      {
        key: "weekly_fideliser_use",
        title: i18nT("utiliser_fideliser_af919842"),
        subtitle: i18nT("10_ui_1_action_semaine_8dafdd90"),
        done: didFideliser,
        premiumOnly: edition === "standard",
      },
    ];
  }, [edition, events, weekStart]);

  const labelFromAction = useMemo(() => {
    return {
      account_open: "Ouverture du compte",
      profile_complete: "Profil complété",
      activity_complete: "Activité complétée",
      create_actu: "Utilisation Booster",
      weekly_feature_use: "Ancienne mission commune",
      weekly_propulser_use: "Action Propulser",
      weekly_fideliser_use: "Action Fidéliser",
      monthly_seniority: "Ancienneté",
    } as Record<string, string>;
  }, []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(15,23,42,0.55)",
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800, fontSize: 16 }}>
              {i18nT("unites_d_apos_inertie_a9f73b8d")}{" "}</div>
            <div style={{ color: "rgba(255,255,255,0.64)", fontSize: 13, marginTop: 6 }}>
              {i18nT("turbo_ui_62a2f457")}{" "}<b>×{snapshot.multiplier}</b> — {snapshot.connectedCount}/{snapshot.totalChannels} canaux
            </div>
          </div>

          <div
            style={{
              minWidth: 120,
              textAlign: "right",
            }}
          >
            <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12 }}>{i18nT("solde_ui_86037358")}</div>
            <div style={{ color: "rgba(255,255,255,0.95)", fontWeight: 900, fontSize: 22 }}>
              {loading ? "…" : uiBalance}
            </div>
          </div>
        </div>

      </div>

      {/* Bouton Boutique */}
      <button
        type="button"
        onClick={onOpenBoutique}
        style={{
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(56,189,248,0.10) 55%, rgba(34,197,94,0.08))",
          borderRadius: 18,
          padding: 14,
          textAlign: "left",
          cursor: onOpenBoutique ? "pointer" : "default",
        }}
        aria-disabled={!onOpenBoutique}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ color: "rgba(255,255,255,0.92)", fontWeight: 900, fontSize: 15 }}>
              {i18nT("boutique_05236d3a")}{" "}</div>
            <div style={{ color: "rgba(255,255,255,0.66)", fontSize: 13, marginTop: 6 }}>
              {i18nT("depensez_vos_ui_ou_commandez_en_704bd67d")}{" "}</div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(15,23,42,0.55)",
              color: "rgba(255,255,255,0.9)",
              fontWeight: 850,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            {i18nT("ouvrir_7fd29c03")}{" "}</div>
        </div>
      </button>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(15,23,42,0.45)",
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.9)", fontWeight: 800, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span>{i18nT("detail_du_multiplicateur_96e13a14")}</span>
            <span style={{ color: "rgba(255,255,255,0.60)", fontSize: 12, fontWeight: 650 }}>
              {i18nT("bulle_verte_quand_outil_connecte_ccfe01c6")}{" "}</span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {snapshot.breakdown.map((b) => (
            <div
              key={b.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: b.connected ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ color: "rgba(255,255,255,0.88)", fontWeight: 650 }}>
                {b.label}
              </div>
              <div style={{ color: "rgba(255,255,255,0.72)", fontWeight: 750 }}>
                <span style={{ opacity: b.connected ? 1 : 0.5 }}>{`+${b.bonus}`}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
          {i18nT("plafond_value_1bc731e7", { value0: snapshot.maxMultiplier })}</div>
      </div>

      {/* Boosts (semaine) */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(15,23,42,0.40)",
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.9)", fontWeight: 800, marginBottom: 10 }}>
          {i18nT("boosts_a_faire_cette_semaine_a0a21688")}{" "}</div>

        {edition === "standard" ? (
          <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12.5, margin: "-2px 0 10px" }}>
            {i18nT("booster_est_votre_mission_active_les_93914a0a")}{" "}</div>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          {boosts.map((b) => {
            const premiumLocked = Boolean("premiumOnly" in b && b.premiumOnly);
            return (
              <div
                key={b.key}
                aria-disabled={premiumLocked || undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: premiumLocked
                    ? "1px solid rgba(168,85,247,0.16)"
                    : "1px solid rgba(255,255,255,0.10)",
                  background: premiumLocked
                    ? "rgba(255,255,255,0.018)"
                    : b.done
                      ? "rgba(34,197,94,0.08)"
                      : "rgba(255,255,255,0.03)",
                  opacity: premiumLocked ? 0.58 : 1,
                  filter: premiumLocked ? "grayscale(0.72)" : undefined,
                }}
              >
                <div style={{ color: "rgba(255,255,255,0.86)" }}>
                  <div style={{ fontWeight: 750 }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{b.subtitle}</div>
                </div>
                {premiumLocked ? (
                  <span
                    style={{
                      padding: "5px 9px",
                      borderRadius: 999,
                      border: "1px solid rgba(192,132,252,0.34)",
                      background: "rgba(126,34,206,0.18)",
                      color: "rgba(233,213,255,0.92)",
                      fontSize: 11,
                      fontWeight: 850,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {i18nT("forfait_premium_65aaf9d2")}{" "}</span>
                ) : (
                  <div
                    style={{
                      fontWeight: 900,
                      color: b.done ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.done ? i18nT("fait_70149085") : i18nT("a_faire_262bf4ea")}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
          {i18nT("reinitialisation_automatique_chaque_lundi_f27eba74")}{" "}</div>
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(15,23,42,0.40)",
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.9)", fontWeight: 800, marginBottom: 10 }}>
          {i18nT("historique_34f3a06a")}{" "}</div>

        {!supabaseReady ? (
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>
            {i18nT("supabase_tables_fidelite_non_activees_a_77d4e794")}{" "}</div>
        ) : loading ? (
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>{i18nT("chargement_01cba1df")}</div>
        ) : events.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>
            {i18nT("aucun_mouvement_pour_le_moment_5b0ccc2a")}{" "}</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {events.map((e) => {
              const premiumHistory =
                edition === "standard" && PREMIUM_INERTIA_ACTION_KEYS.has(e.action_key);
              return (
                <div
                  key={e.id}
                  aria-disabled={premiumHistory || undefined}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    opacity: premiumHistory ? 0.5 : 1,
                    filter: premiumHistory ? "grayscale(0.7)" : undefined,
                  }}
                >
                  <div style={{ color: "rgba(255,255,255,0.82)" }}>
                    <div style={{ fontWeight: 650 }}>
                      {e.label ?? labelFromAction[e.action_key] ?? i18nT("inertie_0c1116ac")}
                      {premiumHistory ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            fontWeight: 850,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {i18nT("forfait_premium_65aaf9d2")}{" "}</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                      {new Date(e.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.88)", fontWeight: 850 }}>
                    {e.amount > 0 ? `+${e.amount}` : e.amount}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
