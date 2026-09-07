"use client";

import { useTranslations } from "next-intl";


import { useEffect, useMemo, useState } from "react";
import styles from "../dashboard.module.css";
import { getNormalizedSiteDomain } from "../dashboard.utils";
import { normalizeActusAccent } from "../dashboard.types";
import type { ActusDesign, ActusLayout, ActusTheme } from "../dashboard.types";

type GeneratedActusWidgetConfig = {
  savedUrl: string;
  source: "inrcy_site" | "site_web";
  layout: ActusLayout;
  limit: number;
  design: ActusDesign;
  theme: ActusTheme;
  accent: string;
  token: string;
};

type WidgetInstallTarget = "html" | "react_next";

type SiteActusWidgetCodeProps = GeneratedActusWidgetConfig & {
  showCode: boolean;
  onToggle: () => void;
  onHideCode: () => void;
  onGenerate: () => Promise<boolean> | boolean;
  onRequestToken?: () => Promise<string>;
};

const getConfigKey = (config: GeneratedActusWidgetConfig | null) => {
  if (!config) return "";
  return [config.savedUrl, config.source, config.layout, config.limit, config.design, config.theme, config.accent, config.token].join("|");
};

const getPublicAppOrigin = () => {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://app.inrcy.com";
  try {
    return new URL(configuredOrigin).origin;
  } catch {
    return "https://app.inrcy.com";
  }
};

const buildEmbedDefinition = (config: GeneratedActusWidgetConfig) => {
  const domain = getNormalizedSiteDomain(config.savedUrl);
  const publicAppOrigin = getPublicAppOrigin();
  const iframeId = `inrcy-actus-${domain || "site"}-${config.layout}`.replace(/[^a-z0-9_-]/gi, "-");
  const initialHeight = config.layout === "carousel" || config.layout === "grid" ? 560 : config.layout === "compact" ? 360 : 260;
  const embedUrl = new URL(`${publicAppOrigin}/embed/actus`);
  embedUrl.searchParams.set("frameId", iframeId);
  embedUrl.searchParams.set("domain", domain || "votre-site.fr");
  embedUrl.searchParams.set("source", config.source);
  embedUrl.searchParams.set("layout", config.layout);
  embedUrl.searchParams.set("limit", String(config.limit));
  embedUrl.searchParams.set("design", config.design);
  embedUrl.searchParams.set("theme", config.theme);
  const customColor = config.theme === "custom" ? normalizeActusAccent(config.accent) : "";
  if (customColor) embedUrl.searchParams.set("accent", customColor);
  embedUrl.searchParams.set("title", "Actualités");
  embedUrl.searchParams.set("token", config.token);
  const src = embedUrl.toString();

  return { iframeId, initialHeight, publicAppOrigin, src };
};

const escapeHtmlAttribute = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const buildHtmlSnippet = (config: GeneratedActusWidgetConfig) => {
  const { iframeId, initialHeight, publicAppOrigin, src } = buildEmbedDefinition(config);
  const htmlSrc = escapeHtmlAttribute(src);

  return `<iframe id="${iframeId}" src="${htmlSrc}" width="100%" height="${initialHeight}" style="border:0;width:100%;max-width:100%;overflow:hidden;border-radius:24px;background:transparent;display:block;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" scrolling="no" title="Actualités iNrCy"></iframe>
<script>
(function(){
  var iframe=document.getElementById("${iframeId}");
  if(!iframe)return;
  var lastHeight=${initialHeight};
  var ready=false;
  function applyHeight(value){ var h=parseInt(value,10); if(!h||h<140)return; if(Math.abs(h-lastHeight)<2)return; lastHeight=h; iframe.style.height=h+"px"; iframe.setAttribute("height",String(h)); }
  function send(type){ if(!iframe.contentWindow)return; iframe.contentWindow.postMessage({source:"inrcy-host",type:type,frameId:"${iframeId}"},"${publicAppOrigin}"); }
  function onMessage(event){ if(event.origin!=="${publicAppOrigin}")return; if(event.source!==iframe.contentWindow)return; var data=event.data||{}; if(data.frameId!=="${iframeId}")return; if(data.source&&data.source!=="inrcy-embed")return; if(data.type==="inrcy:embed-ready"){ ready=true; applyHeight(data.height); send("inrcy:embed-init"); return; } if(data.type!=="inrcy:embed-resize")return; applyHeight(data.height); }
  window.addEventListener("message",onMessage,false);
  iframe.addEventListener("load",function(){ send("inrcy:embed-init"); });
  setTimeout(function(){ send("inrcy:embed-ping"); },120);
  setTimeout(function(){ if(!ready) send("inrcy:embed-ping"); },500);
  setTimeout(function(){ if(!ready) send("inrcy:embed-ping"); },1200);
  setTimeout(function(){ if(!ready) send("inrcy:embed-ping"); },2600);
})();
<\/script>`;
};

const buildReactNextSnippet = (config: GeneratedActusWidgetConfig) => {
  const { iframeId, initialHeight, publicAppOrigin, src } = buildEmbedDefinition(config);

  return `"use client";

import { useEffect, useRef } from "react";

const INRCY_ORIGIN = ${JSON.stringify(publicAppOrigin)};
const EMBED_URL = ${JSON.stringify(src)};
const FRAME_ID = ${JSON.stringify(iframeId)};
const INITIAL_HEIGHT = ${initialHeight};

export default function InrcyActus() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let lastHeight = INITIAL_HEIGHT;
    let ready = false;

    const applyHeight = (value: unknown) => {
      const height = Number.parseInt(String(value), 10);
      if (!Number.isFinite(height) || height < 140) return;
      if (Math.abs(height - lastHeight) < 2) return;
      lastHeight = height;
      iframe.style.height = height + "px";
      iframe.height = String(height);
    };

    const send = (type: "inrcy:embed-init" | "inrcy:embed-ping") => {
      iframe.contentWindow?.postMessage(
        { source: "inrcy-host", type, frameId: FRAME_ID },
        INRCY_ORIGIN,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== INRCY_ORIGIN || event.source !== iframe.contentWindow) return;
      const data = event.data as {
        source?: string;
        type?: string;
        frameId?: string;
        height?: unknown;
      } | null;
      if (!data || data.frameId !== FRAME_ID) return;
      if (data.source && data.source !== "inrcy-embed") return;
      if (data.type === "inrcy:embed-ready") {
        ready = true;
        applyHeight(data.height);
        send("inrcy:embed-init");
        return;
      }
      if (data.type === "inrcy:embed-resize") applyHeight(data.height);
    };

    const onLoad = () => send("inrcy:embed-init");
    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);

    const timerIds = [
      window.setTimeout(() => send("inrcy:embed-ping"), 120),
      window.setTimeout(() => { if (!ready) send("inrcy:embed-ping"); }, 500),
      window.setTimeout(() => { if (!ready) send("inrcy:embed-ping"); }, 1200),
      window.setTimeout(() => { if (!ready) send("inrcy:embed-ping"); }, 2600),
    ];

    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  return (
    <section id="actualites" style={{ width: "100%" }}>
      <iframe
        ref={iframeRef}
        id={FRAME_ID}
        src={EMBED_URL}
        width="100%"
        height={INITIAL_HEIGHT}
        style={{
          border: 0,
          width: "100%",
          maxWidth: "100%",
          minHeight: 140,
          overflow: "hidden",
          borderRadius: 24,
          background: "transparent",
          display: "block",
        }}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        scrolling="no"
        title="Actualités iNrCy"
      />
    </section>
  );
}`;
};

const buildSnippet = (config: GeneratedActusWidgetConfig, target: WidgetInstallTarget) =>
  target === "react_next" ? buildReactNextSnippet(config) : buildHtmlSnippet(config);

export default function SiteActusWidgetCode({
  savedUrl,
  source,
  layout,
  limit,
  design,
  theme,
  accent,
  token,
  showCode,
  onToggle,
  onHideCode,
  onGenerate,
  onRequestToken,
}: SiteActusWidgetCodeProps) {
  const i18nT = useTranslations("shell");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedConfig, setGeneratedConfig] = useState<GeneratedActusWidgetConfig | null>(null);
  const [installTarget, setInstallTarget] = useState<WidgetInstallTarget>("html");

  const currentConfig = useMemo<GeneratedActusWidgetConfig>(() => ({
    savedUrl,
    source,
    layout,
    limit,
    design,
    theme,
    accent,
    token,
  }), [accent, design, layout, limit, savedUrl, source, theme, token]);

  const domain = getNormalizedSiteDomain(savedUrl);
  const hasSavedUrl = !!savedUrl.trim() && !!domain;
  const hasToken = !!token.trim();
  const hasGeneratedCode = !!generatedConfig;
  const paramsChanged = hasGeneratedCode && getConfigKey(generatedConfig) !== getConfigKey(currentConfig);
  const codeReady = hasSavedUrl && hasToken && !!generatedConfig && !paramsChanged;
  const snippet = generatedConfig ? buildSnippet(generatedConfig, installTarget) : "";

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    if (!generateNotice) return;
    const timer = window.setTimeout(() => setGenerateNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [generateNotice]);

  useEffect(() => {
    if (!codeReady && showCode) onHideCode();
  }, [codeReady, onHideCode, showCode]);

  const handleGenerate = async () => {
    if (!hasSavedUrl) {
      setGenerateNotice(i18nT("enregistrez_d_abord_le_lien_du_01d8abe0"));
      return;
    }
    setIsGenerating(true);
    setCopyNotice(null);
    try {
      let effectiveToken = token.trim();
      if (!effectiveToken && onRequestToken) {
        effectiveToken = (await onRequestToken()).trim();
      }
      if (!effectiveToken) {
        setGenerateNotice(i18nT("token_du_widget_en_preparation_reessayez_769426a3"));
        return;
      }

      const ok = await onGenerate();
      if (ok === false) return;
      setGeneratedConfig({ ...currentConfig, token: effectiveToken });
      onHideCode();
      setGenerateNotice(i18nT("code_genere_avec_succes_vous_pouvez_d4de2c80"));
    } catch {
      setGenerateNotice(i18nT("enregistrement_impossible_pour_le_moment_b9a11825"));
    } finally {
      setIsGenerating(false);
    }
  };

  return <>
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
      <strong className={styles.blockSub}>
        {i18nT("format_d_installation_du_widget_actus_f3d70fa2")}
      </strong>
      <div
        role="group"
        aria-label={i18nT("format_d_installation_du_widget_actus_f3d70fa2")}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {([
          ["html", "HTML / CMS"],
          ["react_next", "React / Next.js"],
        ] as const).map(([value, label]) => {
          const active = installTarget === value;
          return (
            <button
              key={value}
              type="button"
              className={styles.actionBtn}
              aria-pressed={active}
              onClick={() => setInstallTarget(value)}
              style={active ? {
                borderColor: "rgba(56, 189, 248, 0.75)",
                background: "linear-gradient(135deg, rgba(14,165,233,0.28), rgba(168,85,247,0.28))",
                color: "#fff",
              } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>

    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
      <div className={styles.blockSub}>{i18nT("les_medias_sont_affiches_automatiquement_quand_21342321")}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className={styles.actionBtn} onClick={handleGenerate} disabled={!hasSavedUrl || (!hasToken && !onRequestToken) || isGenerating} style={!hasSavedUrl || (!hasToken && !onRequestToken) || isGenerating ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
          {isGenerating ? i18nT("enregistrement_e7d5f232") : hasGeneratedCode ? i18nT("reenregistrer_et_regenerer_3c2dcd86") : i18nT("enregistrer_et_generer_le_code_1cb0df54")}
        </button>
        <button type="button" className={styles.actionBtn} onClick={onToggle} disabled={!codeReady} style={!codeReady ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
          {showCode ? i18nT("masquer_le_code_86dd3838") : i18nT("afficher_le_code_d5d99382")}
        </button>
        <button type="button" className={styles.actionBtn} disabled={!codeReady} style={!codeReady ? { opacity: 0.5, cursor: "not-allowed" } : undefined} onClick={async () => {
          if (!codeReady) return;
          try {
            await navigator.clipboard?.writeText(snippet);
            setCopyNotice(i18nT("code_copie_cdc31064"));
          } catch {
            setCopyNotice(null);
          }
        }}>
          {i18nT("copier_le_code_ffdfce13")}{" "}</button>
      </div>
    </div>

    {!hasGeneratedCode ? <div className={styles.blockSub} style={{ color: "rgba(251,191,36,0.95)", fontWeight: 800 }}>{i18nT("reglez_les_parametres_puis_cliquez_sur_998068de")}</div> : paramsChanged ? <div className={styles.blockSub} style={{ color: "rgba(251,191,36,0.95)", fontWeight: 800 }}>{i18nT("parametres_modifies_enregistrez_pour_generer_un_064d802a")}</div> : null}
    {generateNotice ? <div className={styles.blockSub} style={{ color: generateNotice.startsWith("✅") ? "#4ade80" : "rgba(251,191,36,0.95)", fontWeight: 800 }}>{generateNotice}</div> : null}
    {showCode && codeReady ? <div aria-label={i18nT("code_du_widget_cbab80cb")} onCopy={(event) => event.preventDefault()} onCut={(event) => event.preventDefault()} style={{ width: "100%", minHeight: 170, maxHeight: 420, overflow: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(15,23,42,0.65)", padding: "10px 12px", color: "rgba(255,255,255,0.92)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "none", pointerEvents: "none" }}>{snippet}</div> : null}
    {copyNotice ? <div className={styles.blockSub} style={{ color: "#4ade80", fontWeight: 800 }}>{copyNotice}</div> : null}
    {installTarget === "react_next" ? (
      <div className={styles.blockSub}>
        <strong>{i18nT("ou_le_coller_467285f4")}</strong>{" "}
        {i18nT("installation_react_next_du_widget_actus_a6940a61")}
      </div>
    ) : (
      <div className={styles.blockSub}><strong>{i18nT("ou_le_coller_467285f4")}</strong> {" "}{i18nT("sur_wordpress_un_bloc_08838a7a")}{" "}<em>{i18nT("html_personnalise_33f4a892")}</em> {" "}{i18nT("elementor_widget_html_sur_wix_e512c7c3")}{" "}<em>{i18nT("embed_code_774dc9f7")}</em>{i18nT("sur_webflow_e0108361")}{" "}<em>{i18nT("embed_ad02e14e")}</em>.</div>
    )}
  </>;
}
