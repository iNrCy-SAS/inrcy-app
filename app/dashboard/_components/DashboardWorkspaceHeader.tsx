"use client";

import type { CSSProperties, ReactNode } from "react";

type WorkspaceHeaderAction = {
  label: string;
  onClick: () => void;
  tone?: "cyan" | "violet" | "neutral";
};

type Props = {
  logoSrc?: string;
  logo?: ReactNode;
  title: string;
  subtitle: string;
  actions: WorkspaceHeaderAction[];
};

export default function DashboardWorkspaceHeader({
  logoSrc,
  logo,
  title,
  subtitle,
  actions,
}: Props) {
  return (
    <header data-dashboard-workspace-header style={headerStyle}>
      <div style={brandStyle}>
        {logo || (logoSrc ? <img src={logoSrc} alt="" aria-hidden="true" width={42} height={42} style={logoStyle} /> : null)}
        <span aria-hidden style={dividerStyle} />
        <span style={titleGroupStyle}>
          <h1 style={titleStyle}>{title}</h1>
          <span style={subtitleStyle}>{subtitle}</span>
        </span>
      </div>

      <nav aria-label={title} style={actionsStyle}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            style={{ ...headerButtonBase, ...buttonToneStyles[action.tone || "neutral"] }}
          >
            {action.label}
          </button>
        ))}
      </nav>

      <style jsx>{`
        @media (max-width: 820px) {
          header[data-dashboard-workspace-header] {
            align-items: stretch !important;
            flex-direction: column !important;
          }
          header[data-dashboard-workspace-header] nav {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            width: 100% !important;
          }
        }
        @media (max-width: 520px) {
          header[data-dashboard-workspace-header] {
            padding: 8px !important;
            gap: 9px !important;
            border-radius: 14px !important;
          }
          header[data-dashboard-workspace-header] nav button {
            min-width: 0 !important;
            padding-left: 6px !important;
            padding-right: 6px !important;
            font-size: 10.5px !important;
            white-space: normal !important;
            line-height: 1.2 !important;
          }
          header[data-dashboard-workspace-header] > div {
            width: 100% !important;
          }
          header[data-dashboard-workspace-header] h1 {
            overflow-wrap: anywhere !important;
          }
        }
      `}</style>
    </header>
  );
}

export const dashboardWorkspacePageStyle: CSSProperties = {
  minHeight: "100svh",
  overflowX: "clip",
  padding: "14px clamp(10px, 2.2vw, 28px) max(90px, calc(34px + var(--inrcy-safe-area-bottom)))",
  background: "radial-gradient(900px 480px at 10% 0%, rgba(14,165,233,0.13), transparent 60%), radial-gradient(900px 500px at 92% 4%, rgba(139,92,246,0.15), transparent 62%), linear-gradient(180deg, rgba(5,14,30,0.97), rgba(12,8,28,0.98))",
  color: "rgba(255,255,255,0.92)",
};

export const dashboardWorkspaceContentStyle: CSSProperties = {
  width: "100%",
  maxWidth: 1380,
  margin: "0 auto",
};

const headerStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 40,
  maxWidth: 1460,
  margin: "0 auto 14px",
  padding: "9px 11px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  borderRadius: 17,
  border: "1px solid rgba(125,211,252,0.13)",
  background: "linear-gradient(135deg, rgba(5,15,32,0.96), rgba(17,12,38,0.95))",
  boxShadow: "0 15px 42px rgba(0,0,0,0.25)",
  backdropFilter: "blur(20px)",
};
const brandStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const logoStyle: CSSProperties = { width: 42, height: 42, flex: "0 0 auto", filter: "drop-shadow(0 9px 22px rgba(124,58,237,0.26))" };
const dividerStyle: CSSProperties = { width: 1, height: 30, flex: "0 0 auto", background: "rgba(255,255,255,0.13)" };
const titleGroupStyle: CSSProperties = { display: "grid", gap: 2, minWidth: 0 };
const titleStyle: CSSProperties = { margin: 0, color: "white", fontSize: "clamp(15px, 2vw, 18px)", fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.01em" };
const subtitleStyle: CSSProperties = { maxWidth: "min(52vw, 720px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.60)", fontSize: 10.5, lineHeight: 1.25 };
const actionsStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flex: "0 0 auto" };
const headerButtonBase: CSSProperties = { borderRadius: 10, padding: "7px 10px", color: "rgba(255,255,255,0.90)", cursor: "pointer", fontSize: 11.5, fontWeight: 850, whiteSpace: "nowrap" };
const buttonToneStyles: Record<NonNullable<WorkspaceHeaderAction["tone"]>, CSSProperties> = {
  cyan: { border: "1px solid rgba(56,189,248,0.22)", background: "rgba(14,165,233,0.10)" },
  violet: { border: "1px solid rgba(196,181,253,0.25)", background: "rgba(124,58,237,0.12)" },
  neutral: { border: "1px solid rgba(255,255,255,0.13)", background: "rgba(255,255,255,0.035)" },
};
