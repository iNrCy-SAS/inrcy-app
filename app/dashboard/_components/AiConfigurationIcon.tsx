import type { CSSProperties } from "react";

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
