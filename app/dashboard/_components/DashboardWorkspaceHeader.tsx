"use client";

import type { CSSProperties, ReactNode } from "react";

type WorkspaceHeaderAction = {
  label: string;
  onClick: () => void;
  tone?: "cyan" | "violet" | "neutral";
  disabled?: boolean;
  mobileIcon?: ReactNode;
  mobileBare?: boolean;
};

type Props = {
  logoSrc?: string;
  logo?: ReactNode;
  title: string;
  subtitle: string;
  status?: ReactNode;
  actions: WorkspaceHeaderAction[];
  responsiveTwoRow?: boolean;
};

export default function DashboardWorkspaceHeader({
  logoSrc,
  logo,
  title,
  subtitle,
  status,
  actions,
  responsiveTwoRow = false,
}: Props) {
  return (
    <header
      data-dashboard-workspace-header
      data-responsive-two-row={responsiveTwoRow ? "true" : undefined}
      style={headerStyle}
    >
      <div data-dashboard-workspace-brand style={brandStyle}>
        <span data-dashboard-workspace-logo style={logoSlotStyle}>
          {logo || (logoSrc ? <img src={logoSrc} alt="" aria-hidden="true" width={42} height={42} style={logoStyle} /> : null)}
        </span>
        <span data-dashboard-workspace-divider aria-hidden style={dividerStyle} />
        <span data-dashboard-workspace-title-group style={titleGroupStyle}>
          <h1 style={titleStyle}>{title}</h1>
          <span data-dashboard-workspace-subtitle style={subtitleStyle}>{subtitle}</span>
        </span>
      </div>

      <nav aria-label={title} style={actionsStyle}>
        {status}
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            aria-label={action.label}
            title={action.label}
            data-has-mobile-icon={action.mobileIcon ? "true" : undefined}
            data-mobile-bare={action.mobileBare ? "true" : undefined}
            style={{
              ...headerButtonBase,
              ...buttonToneStyles[action.tone || "neutral"],
              cursor: action.disabled ? "not-allowed" : "pointer",
              opacity: action.disabled ? 0.52 : 1,
            }}
          >
            <span data-dashboard-workspace-action-label>{action.label}</span>
            {action.mobileIcon ? (
              <span data-dashboard-workspace-action-icon aria-hidden="true">
                {action.mobileIcon}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <style jsx>{`
        header[data-dashboard-workspace-header] [data-dashboard-workspace-action-icon] {
          display: none;
        }
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
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] {
            display: grid !important;
            grid-template-columns: auto auto minmax(0, 1fr) auto !important;
            grid-template-rows: auto auto !important;
            align-items: center !important;
            gap: 6px 10px !important;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] > [data-dashboard-workspace-brand],
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] [data-dashboard-workspace-title-group] {
            display: contents !important;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] [data-dashboard-workspace-logo] {
            grid-column: 1;
            grid-row: 1;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] [data-dashboard-workspace-divider] {
            grid-column: 2;
            grid-row: 1;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] h1 {
            grid-column: 3;
            grid-row: 1;
            min-width: 0;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] [data-dashboard-workspace-subtitle] {
            grid-column: 1 / -1;
            grid-row: 2;
            max-width: none !important;
            overflow: visible !important;
            text-overflow: clip !important;
            white-space: normal !important;
            overflow-wrap: anywhere;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav {
            grid-column: 4;
            grid-row: 1;
            display: flex !important;
            grid-template-columns: none !important;
            width: auto !important;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav button[data-has-mobile-icon="true"] {
            display: inline-flex;
            width: 38px;
            min-width: 38px;
            height: 38px;
            min-height: 38px;
            padding: 0 !important;
            align-items: center;
            justify-content: center;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav button[data-has-mobile-icon="true"] [data-dashboard-workspace-action-label] {
            display: none;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav button[data-has-mobile-icon="true"] [data-dashboard-workspace-action-icon] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            line-height: 1;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav button[data-mobile-bare="true"] {
            border-color: transparent !important;
            background: transparent !important;
            box-shadow: none !important;
          }
        }
        header[data-dashboard-workspace-header] nav button:focus-visible {
          outline: 3px solid var(--inrcy-theme-focus-ring, rgba(111, 224, 255, 0.34));
          outline-offset: 2px;
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
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] > [data-dashboard-workspace-brand] {
            width: auto !important;
          }
          header[data-dashboard-workspace-header][data-responsive-two-row="true"] nav button[data-has-mobile-icon="true"] {
            width: 36px;
            min-width: 36px !important;
            height: 36px;
            min-height: 36px;
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
  background: "var(--inrcy-theme-page-background, radial-gradient(900px 480px at 10% 0%, rgba(14,165,233,0.13), transparent 60%), radial-gradient(900px 500px at 92% 4%, rgba(139,92,246,0.15), transparent 62%), linear-gradient(180deg, rgba(5,14,30,0.97), rgba(12,8,28,0.98)))",
  color: "var(--inrcy-theme-text-primary, rgba(255,255,255,0.92))",
};

export const dashboardWorkspaceContentStyle: CSSProperties = {
  width: "100%",
  maxWidth: "none",
  margin: 0,
};

const headerStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 40,
  width: "100%",
  maxWidth: "none",
  margin: "0 0 14px",
  padding: "9px 11px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  borderRadius: 17,
  border: "1px solid var(--inrcy-theme-border, rgba(125,211,252,0.13))",
  background: "var(--inrcy-theme-drawer-background, linear-gradient(135deg, rgba(5,15,32,0.96), rgba(17,12,38,0.95)))",
  boxShadow: "var(--inrcy-theme-shadow-soft, 0 15px 42px rgba(0,0,0,0.25))",
  backdropFilter: "blur(20px)",
};
const brandStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const logoSlotStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" };
const logoStyle: CSSProperties = { width: 42, height: 42, flex: "0 0 auto", filter: "drop-shadow(0 9px 22px rgba(124,58,237,0.26))" };
const dividerStyle: CSSProperties = { width: 1, height: 30, flex: "0 0 auto", background: "var(--inrcy-theme-border-strong, rgba(255,255,255,0.13))" };
const titleGroupStyle: CSSProperties = { display: "grid", gap: 2, minWidth: 0 };
const titleStyle: CSSProperties = { margin: 0, color: "var(--inrcy-theme-text-primary, white)", fontSize: "clamp(15px, 2vw, 18px)", fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.01em" };
const subtitleStyle: CSSProperties = { maxWidth: "min(52vw, 720px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--inrcy-theme-text-muted, rgba(255,255,255,0.60))", fontSize: 10.5, lineHeight: 1.25 };
const actionsStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flex: "0 0 auto" };
const headerButtonBase: CSSProperties = { borderRadius: 10, padding: "7px 10px", color: "var(--inrcy-theme-text-primary, rgba(255,255,255,0.90))", cursor: "pointer", fontSize: 11.5, fontWeight: 850, whiteSpace: "nowrap" };
const buttonToneStyles: Record<NonNullable<WorkspaceHeaderAction["tone"]>, CSSProperties> = {
  cyan: { border: "1px solid rgba(var(--inrcy-theme-accent-rgb-1, 56,189,248),0.32)", background: "rgba(var(--inrcy-theme-accent-rgb-1, 14,165,233),0.10)" },
  violet: { border: "1px solid rgba(var(--inrcy-theme-accent-rgb-2, 196,181,253),0.30)", background: "rgba(var(--inrcy-theme-accent-rgb-2, 124,58,237),0.12)" },
  neutral: { border: "1px solid var(--inrcy-theme-border, rgba(255,255,255,0.13))", background: "var(--inrcy-theme-surface-soft, rgba(255,255,255,0.035))" },
};
