"use client";

type Props = {
  onClick: () => void;
  title?: string;
  size?: number; // px
};

export default function HelpButton({ onClick, title = "Aide", size = 28 }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid rgba(120,180,255,0.38)",
        background: "linear-gradient(135deg, rgba(0,180,255,0.22), rgba(167,72,255,0.24), rgba(255,92,138,0.18))",
        color: "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 0 18px rgba(0,180,255,0.32), 0 0 30px rgba(167,72,255,0.18)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onMouseDown={(e) => e.preventDefault()} // évite de voler le focus (petit confort)
    >
      <span style={{ fontWeight: 900, fontSize: 15, lineHeight: 1, textShadow: "0 0 10px rgba(255,255,255,0.45)" }}>?</span>
    </button>
  );
}