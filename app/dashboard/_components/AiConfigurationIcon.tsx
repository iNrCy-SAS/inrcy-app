import type { CSSProperties } from "react";

/** Existing Configuration IA page bubble, shared by the corresponding entry points. */
export const AI_CONFIGURATION_BUBBLE_STYLE: CSSProperties = {
  borderRadius: 999,
  border: "1px solid rgba(250,204,21,0.42)",
  background: "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.32), transparent 26%), linear-gradient(135deg, rgba(250,204,21,0.28), rgba(251,146,60,0.16), rgba(167,139,250,0.12))",
  boxShadow: "0 0 22px rgba(250,204,21,0.16)",
  fontSize: 15,
};

type Props = {
  size?: number;
  className?: string;
  style?: CSSProperties;
};

/** Historical yellow "IA" monogram for compact icon-only controls and the Configuration IA page mark. */
export default function AiConfigurationIcon({ size = 20, className, style }: Props) {
  const fontSize = Math.max(10, Math.round(size * 0.6));

  return (
    <span
      data-ai-configuration-icon
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fde68a",
        fontSize,
        fontWeight: 950,
        lineHeight: 1,
        letterSpacing: "0.04em",
        textShadow: "0 0 14px rgba(250,204,21,0.50)",
        ...style,
      }}
    >
      IA
    </span>
  );
}
