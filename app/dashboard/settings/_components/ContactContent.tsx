"use client";

import { useSearchParams } from "next/navigation";

type Props = {
  mode?: "page" | "drawer";
};

export default function ContactContent({ mode = "page" }: Props) {
  const searchParams = useSearchParams();
  const premiumRequired = searchParams.get("premium") === "required";
  const EMAIL = "contact@inrcy.com";
  const PHONE_DISPLAY = "06.22.08.21.79";
  const PHONE_TEL = "+33622082179"; // format tel: (plus clean)
  const SITE = "https://inrcy.com";

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  const shell: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.14), rgba(97, 87, 255, 0.10) 45%, rgba(0, 200, 255, 0.08))",
  };

  const titleAccent: React.CSSProperties = {
    margin: 0,
    fontSize: 16,
    paddingLeft: 10,
    borderLeft: "3px solid transparent",
    borderImage: "linear-gradient(180deg, rgba(255,77,166,0.95), rgba(97,87,255,0.85), rgba(0,200,255,0.75)) 1",
  };

  const badge: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.22), rgba(97, 87, 255, 0.16), rgba(0, 200, 255, 0.12))",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  };

  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.35), rgba(97, 87, 255, 0.28), rgba(0, 200, 255, 0.22))",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  };

  const secondaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  };

  const smallBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "white",
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    whiteSpace: "nowrap",
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback silencieux (pas bloquant)
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {premiumRequired ? (
        <div style={{
          ...card,
          borderColor: "rgba(183, 102, 255, 0.32)",
          background: "linear-gradient(135deg, rgba(112, 52, 207, 0.18), rgba(255, 73, 164, 0.10))",
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: "#d8b6ff" }}>
            iNrCy Premium
          </div>
          <h2 style={{ margin: "6px 0 5px", fontSize: 18 }}>Cette fonctionnalité fait partie de Premium</h2>
          <p style={{ margin: 0, opacity: 0.78, lineHeight: 1.5 }}>
            Le passage à Premium se fait avec un conseiller iNrCy, sans achat automatique dans l’application.
          </p>
        </div>
      ) : null}
      {/* HERO */}
      <div style={{ ...card, ...shell, padding: 18 }}>
        <h2 style={titleAccent}>Contactez-nous</h2>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={badge}>RÉPONSE SOUS 48H</span>
          <span style={badge}>MAIL & TÉLÉPHONE</span>
        </div>
        <p style={{ margin: "10px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
          Besoin d’aide, d'une démo, d’une information ou d’un ajustement ? Écrivez-nous ou appelez-nous, on s’occupe de vous rapidement.
        </p>
      </div>

      {/* EMAIL */}
      <div style={card}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Par email</h3>
        <p style={{ margin: "8px 0 0", opacity: 0.85 }}>
          Adresse : <b>{EMAIL}</b>
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <a
            href={`mailto:${EMAIL}?subject=${encodeURIComponent("Demande iNrCy")}`}
            style={primaryBtn}
          >
            Envoyer un email
          </a>

          <button type="button" onClick={() => copy(EMAIL)} style={smallBtn}>
            Copier l’email
          </button>
        </div>
      </div>

      {/* TÉLÉPHONE */}
      <div style={card}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Par téléphone</h3>
        <p style={{ margin: "8px 0 0", opacity: 0.85 }}>
          Du lundi au vendredi, <b>10h → 18h</b>
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <a href={`tel:${PHONE_TEL}`} style={secondaryBtn}>
            Appeler : {PHONE_DISPLAY}
          </a>

          <button type="button" onClick={() => copy(PHONE_DISPLAY)} style={smallBtn}>
            Copier le numéro
          </button>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            </div>
        </div>
      </div>

      {/* SITE */}
      <div style={card}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Ressources</h3>
        <p style={{ margin: "8px 0 0", opacity: 0.85 }}>
          Découvrir iNrCy et nos solutions.
        </p>

        <div style={{ marginTop: 12 }}>
          <a href={SITE} target="_blank" rel="noreferrer" style={primaryBtn}>
            Visitez notre site
          </a>
        </div>
      </div>

      {mode === "page" ? null : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          </div>
      )}
    </div>
  );
}
