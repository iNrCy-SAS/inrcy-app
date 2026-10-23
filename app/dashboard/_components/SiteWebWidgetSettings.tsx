"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SiteWebBubbleProps } from "./SiteWebBubbleControls";
import ActusWidgetControls from "./ActusWidgetControls";
import SiteActusWidgetCode from "./SiteActusWidgetCode";

export default function SiteWebWidgetSettings({ site, onDirtyChange }: { site: SiteWebBubbleProps; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("shell");
  const signature = JSON.stringify([site.siteWebActusLayout, site.siteWebActusLimit, site.siteWebActusDesign, site.siteWebActusTheme, site.siteWebActusAccent]);
  const baseline = useRef(signature);
  const [savedRevision, setSavedRevision] = useState(0);
  useEffect(() => { onDirtyChange(signature !== baseline.current); }, [onDirtyChange, savedRevision, signature]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  return <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
    <h3 style={{ margin: 0, paddingRight: 40, color: "#eef5ff", fontSize: 20 }}>{t("widget_actus_13beb3e6")}</h3>
    <p style={{ margin: 0, color: "#b8cde8", fontSize: 13, lineHeight: 1.5 }}>{t("collez_ce_code_iframe_dans_votre_81743f90")}</p>
    <ActusWidgetControls layout={site.siteWebActusLayout} setLayout={site.setSiteWebActusLayout} limit={site.siteWebActusLimit} setLimit={site.setSiteWebActusLimit} design={site.siteWebActusDesign} setDesign={site.setSiteWebActusDesign} theme={site.siteWebActusTheme} setTheme={site.setSiteWebActusTheme} accent={site.siteWebActusAccent} setAccent={site.setSiteWebActusAccent} />
    <SiteActusWidgetCode savedUrl={site.siteWebSavedUrl} source="site_web" layout={site.siteWebActusLayout} limit={site.siteWebActusLimit} design={site.siteWebActusDesign} theme={site.siteWebActusTheme} accent={site.siteWebActusAccent} token={site.widgetTokenSiteWeb} showCode={site.showSiteWebWidgetCode} onToggle={() => site.setShowSiteWebWidgetCode((value: boolean) => !value)} onHideCode={() => site.setShowSiteWebWidgetCode(false)} onRequestToken={site.requestSiteWebWidgetToken} onGenerate={async () => { const saved = await site.saveSiteWebActusWidgetSettings(); if (saved) { baseline.current = signature; setSavedRevision(value => value + 1); onDirtyChange(false); } return saved; }} />
  </div>;
}
