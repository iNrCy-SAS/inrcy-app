"use client";

type Props = {
  onOpenContact: () => void;
};

const premiumFeatures = [
  "iNr'Agent complet avec Propulser et Fidéliser",
  "iNr'Send complet et campagnes mails",
  "iNr'CRM et gestion commerciale",
  "Agenda et suivi des rendez-vous",
  "Propulser et Fidéliser",
];

export default function StandardSubscriptionContent({ onOpenContact }: Props) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{
        padding: 18,
        borderRadius: 18,
        border: "1px solid rgba(61, 222, 255, 0.28)",
        background: "linear-gradient(135deg, rgba(26, 127, 255, 0.16), rgba(61, 223, 255, 0.08))",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.72, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Votre forfait
            </div>
            <h2 style={{ margin: "5px 0 0", fontSize: 24 }}>iNrCy Standard</h2>
          </div>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 11px",
            borderRadius: 999,
            border: "1px solid rgba(45, 225, 157, 0.3)",
            background: "rgba(16, 128, 88, 0.2)",
            color: "#8ff7d0",
            fontSize: 12,
            fontWeight: 900,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2ce5a2", boxShadow: "0 0 9px #2ce5a2" }} />
            Actif
          </span>
        </div>
        <p style={{ margin: "14px 0 0", opacity: 0.78, lineHeight: 1.55 }}>
          Booster sur 10 canaux, iNr&apos;Agent Publications + Statistiques,
          iNr&apos;Badge inclus, iNr&apos;Stats, historique iNr&apos;Send et Réputation.
        </p>
      </section>

      <section style={{
        padding: 18,
        borderRadius: 18,
        border: "1px solid rgba(180, 99, 255, 0.25)",
        background: "linear-gradient(145deg, rgba(124, 55, 220, 0.13), rgba(255, 75, 172, 0.08))",
      }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.68, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Autre forfait
        </div>
        <h2 style={{ margin: "5px 0 4px", fontSize: 24 }}>iNrCy Premium</h2>
        <p style={{ margin: "0 0 14px", opacity: 0.75, lineHeight: 1.5 }}>
          Passez du pilotage de votre visibilité au pilotage complet de votre activité.
        </p>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {premiumFeatures.map((feature) => (
            <div key={feature} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13, opacity: 0.86 }}>
              <span aria-hidden="true" style={{ color: "#8feaff", fontWeight: 950 }}>✓</span>
              {feature}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenContact}
          style={{
            width: "100%",
            minHeight: 44,
            border: "1px solid rgba(255,255,255,.18)",
            borderRadius: 14,
            color: "white",
            background: "linear-gradient(115deg, rgba(39, 154, 255, .78), rgba(133, 74, 239, .82), rgba(238, 72, 163, .72))",
            boxShadow: "0 12px 30px rgba(86, 65, 220, .22)",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Nous contacter pour Premium
        </button>
        <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 11, opacity: 0.58 }}>
          Le passage à Premium nécessite un échange avec l’équipe iNrCy.
        </p>
      </section>
    </div>
  );
}
