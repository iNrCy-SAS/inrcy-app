"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./gps.module.css";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import type { GpsArticle, GpsArticleSource, GpsMessageKey } from "./noticeContent";
import { getGpsSectionsForEdition, isGpsSectionPremiumOnly } from "./gpsEditionPolicy";

type GpsTranslator = (key: GpsMessageKey) => string;

function localizeGpsArticle(article: GpsArticleSource, translate: GpsTranslator): GpsArticle {
  return {
    ...article,
    title: translate(article.title),
    keywords: article.keywords.map(translate),
    intro: translate(article.intro),
    steps: article.steps.map(translate),
    checks: article.checks?.map(translate),
    pitfalls: article.pitfalls?.map(translate),
    faq: article.faq?.map((item) => ({ q: translate(item.q), a: translate(item.a) })),
    links: article.links?.map((link) => ({ ...link, label: translate(link.label) })),
    duration: article.duration ? translate(article.duration) : article.duration,
    goal: article.goal ? translate(article.goal) : article.goal,
  };
}

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderStrongParts(input: string) {
  return input.split(/(\*\*.*?\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function rememberPanelLink(href: string) {
  if (typeof window === "undefined" || !href.startsWith("/dashboard?")) return;

  try {
    const query = href.split("?")[1] || "";
    const params = new URLSearchParams(query);
    const panel = params.get("panel");
    if (!panel) return;

    sessionStorage.setItem("inrcy_panel_explicit_open", "1");
    sessionStorage.setItem("inrcy_last_panel", panel);
  } catch {}
}

type SearchHit = {
  article: GpsArticle;
  sectionId: string;
  sectionTitle: string;
  sectionEmoji: string;
  premiumOnly: boolean;
  score: number;
};

export default function GpsClient() {
  const i18nT = useTranslations("gps");
  const translateKey = useCallback<GpsTranslator>((key) => i18nT(key as never), [i18nT]);
  const dashboardEdition = useDashboardEdition();
  const standardMode = dashboardEdition === "standard";
  const gpsSections = useMemo(
    () => getGpsSectionsForEdition(dashboardEdition).map((section) => ({
      ...section,
      title: translateKey(section.title),
      description: translateKey(section.description),
      articles: section.articles.map((article) => localizeGpsArticle(article, translateKey)),
    })),
    [dashboardEdition, translateKey],
  );
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>(gpsSections[0]?.id ?? "");
  const [activeArticleId, setActiveArticleId] = useState<string>(gpsSections[0]?.articles[0]?.id ?? "");
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const sectionPickerRef = useRef<HTMLDivElement | null>(null);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);

  const selectedSection = useMemo(
    () => gpsSections.find((section) => section.id === activeSection) ?? gpsSections[0],
    [activeSection, gpsSections]
  );
  const selectedSectionPremium = Boolean(
    standardMode && selectedSection && isGpsSectionPremiumOnly(selectedSection.id),
  );

  const selectedArticle =
    selectedSection?.articles.find((article) => article.id === activeArticleId) ?? selectedSection?.articles[0];
  const focusItems = selectedArticle
    ? [
        selectedArticle.goal ? `Objectif : **${selectedArticle.goal}**.` : "",
        ...(selectedArticle.pitfalls ?? []),
      ].filter(Boolean).slice(0, 3)
    : [];

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (sectionPickerRef.current && !sectionPickerRef.current.contains(target)) {
        setSectionMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSectionMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const hits = useMemo((): SearchHit[] => {
    const q = normalizeText(query);
    if (!q) return [];

    const results: SearchHit[] = [];
    for (const section of gpsSections) {
      for (const article of section.articles) {
        const title = normalizeText(article.title);
        const keywords = normalizeText(article.keywords.join(" "));
        const body = normalizeText(
          [
            section.title,
            section.description,
            article.intro,
            article.goal ?? "",
            article.duration ?? "",
            ...(article.steps ?? []),
            ...(article.checks ?? []),
            ...(article.pitfalls ?? []),
            ...((article.faq ?? []).flatMap((f) => [f.q, f.a])),
          ].join(" ")
        );

        let score = 0;
        if (normalizeText(section.title).includes(q)) score += 80;
        if (title.includes(q)) score += 70;
        if (keywords.includes(q)) score += 35;
        if (body.includes(q)) score += 12;

        if (score > 0) {
          results.push({
            article,
            sectionId: section.id,
            sectionTitle: section.title,
            sectionEmoji: section.emoji,
            premiumOnly: standardMode && isGpsSectionPremiumOnly(section.id),
            score,
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [gpsSections, query, standardMode]);

  const openSection = (sectionId: string, articleId?: string) => {
    const section = gpsSections.find((item) => item.id === sectionId);
    setActiveSection(sectionId);
    setActiveArticleId(articleId ?? section?.articles[0]?.id ?? "");
    setQuery("");
    setSectionMenuOpen(false);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">
            🧭
          </div>
          <div className={styles.brandText}>
            <h1 className={styles.title}>{i18nT("gps_d_utilisation_5f30c155")}</h1>
            <p className={styles.subtitle}>{i18nT("le_guide_express_pour_utiliser_inrcy_1eb58463")}</p>
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.searchWrap} ref={searchWrapRef}>
            <label className={styles.searchLabel} htmlFor="gps-search">
              {i18nT("rechercher_dans_le_gps_f9b7d9e4")}{" "}</label>
            <span className={styles.searchIcon}>🔎</span>
            <input
              id="gps-search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={i18nT("rechercher_8bd64daa")}
              autoComplete="off"
            />

            {hits.length > 0 && (
              <div className={styles.searchResults} role="listbox" aria-label={i18nT("resultats_de_recherche_f9fa293c")}>
                {hits.map((hit) => (
                  <button
                    key={`${hit.sectionId}:${hit.article.id}`}
                    type="button"
                    className={styles.searchResult}
                    onClick={() => openSection(hit.sectionId, hit.article.id)}
                  >
                    <span className={styles.searchResultTitle}>
                      {hit.sectionEmoji} {hit.sectionTitle}
                      {hit.premiumOnly ? <span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span> : null}
                    </span>
                    <span className={styles.searchResultMeta}>{hit.article.title}</span>
                  </button>
                ))}
              </div>
            )}

            {query && hits.length === 0 && (
              <div className={styles.searchResults} role="status" aria-label={i18nT("aucun_resultat_9e524fe1")}>
                <div className={styles.noResult}>{i18nT("aucun_resultat_essayez_google_devis_mail_cb2eb93e")}</div>
              </div>
            )}
          </div>

          <ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" href="/dashboard" />
        </div>
      </header>

      <main className={styles.main}>
        {selectedSection && (
          <div className={styles.mobileSectionPicker} ref={sectionPickerRef}>
            <div className={styles.mobilePickerLabel}>{i18nT("rubrique_active_291ff341")}</div>
            <button
              type="button"
              className={styles.mobilePickerButton}
              onClick={() => setSectionMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={sectionMenuOpen}
            >
              <span className={styles.mobilePickerCurrent}>
                <span aria-hidden="true">{selectedSection.emoji}</span>
                <span>{selectedSection.title}</span>
              </span>
              {selectedSectionPremium ? <span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span> : null}
              <span className={styles.mobilePickerArrow} aria-hidden="true">▾</span>
            </button>

            {sectionMenuOpen && (
              <div className={styles.mobilePickerMenu} role="menu" aria-label={i18nT("choisir_une_rubrique_gps_c8357f33")}>
                {gpsSections.map((section) => {
                  const isActive = selectedSection.id === section.id;
                  const premiumOnly = standardMode && isGpsSectionPremiumOnly(section.id);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      role="menuitem"
                      className={`${styles.mobilePickerItem} ${isActive ? styles.mobilePickerItemActive : ""} ${premiumOnly ? styles.mobilePickerItemPremium : ""}`}
                      onClick={() => openSection(section.id)}
                    >
                      <span aria-hidden="true">{section.emoji}</span>
                      <span>{section.title}</span>
                      {premiumOnly ? <span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div>
              <div className={styles.sidebarTitle}>{i18nT("rubriques_a5155d21")}</div>
              <div className={styles.sidebarHint}>{i18nT("une_seule_ouverte_a_droite_4a2620e9")}</div>
            </div>
            <span className={styles.sidebarBadge}>{gpsSections.length}</span>
          </div>

          <nav className={styles.nav} aria-label={i18nT("navigation_gps_2ebb5c69")}>
            {gpsSections.map((section) => {
              const isActive = selectedSection?.id === section.id;
              const premiumOnly = standardMode && isGpsSectionPremiumOnly(section.id);
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`${styles.navSection} ${isActive ? styles.navSectionActive : ""} ${premiumOnly ? styles.navSectionPremium : ""}`}
                  onClick={() => openSection(section.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className={styles.navEmoji}>{section.emoji}</span>
                  <span className={styles.navLabel}>{section.title}</span>
                  {premiumOnly ? <span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className={styles.content} aria-live="polite">
          {selectedSection && selectedArticle && (
            <div className={`${styles.panel} ${selectedSectionPremium ? styles.panelPremium : ""}`}>
              <div className={styles.panelTop}>
                <div className={styles.panelHeader}>
                  <div className={styles.panelIcon} aria-hidden="true">
                    {selectedSection.emoji}
                  </div>
                  <div className={styles.panelTitleWrap}>
                    <span className={styles.panelKicker}>{i18nT("rubrique_active_291ff341")}</span>
                    <h2 className={styles.panelTitle}>{selectedSection.title}</h2>
                    <p className={styles.panelDesc}>{selectedSection.description}</p>
                  </div>
                  {selectedArticle.duration && <span className={styles.timeBadge}>⏱ {selectedArticle.duration}</span>}
                </div>

                {selectedSectionPremium ? (
                  <div className={styles.premiumNotice} role="note">
                    <span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span>
                    <span>{i18nT("cette_rubrique_presente_un_outil_disponible_ff4b0e16")}</span>
                  </div>
                ) : null}

                {selectedSection.articles.length > 1 && (
                  <div className={styles.articleTabs} role="tablist" aria-label={i18nT("guides_value_4d60cd25", { value0: selectedSection.title })}>
                    {selectedSection.articles.map((article) => {
                      const isActive = article.id === selectedArticle.id;
                      return (
                        <button
                          key={article.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className={`${styles.articleTab} ${isActive ? styles.articleTabActive : ""}`}
                          onClick={() => setActiveArticleId(article.id)}
                        >
                          {article.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={styles.grid}>
                <article className={styles.infoCard}>
                  <h3 className={styles.cardTitle}>
                    <span className={`${styles.titleDot} ${styles.titleDotPurpose}`} aria-hidden="true" />
                    {i18nT("a_quoi_ca_sert_d75da076")}{" "}</h3>
                  <p>{selectedArticle.intro}</p>
                </article>

                <article className={styles.infoCard}>
                  <h3 className={styles.cardTitle}>
                    <span className={`${styles.titleDot} ${styles.titleDotHow}`} aria-hidden="true" />
                    {i18nT("comment_l_utiliser_cadca3b9")}{" "}</h3>
                  <ol className={styles.steps}>
                    {selectedArticle.steps.slice(0, selectedArticle.maxSteps ?? 4).map((step, idx) => (
                      <li key={idx}>{renderStrongParts(step)}</li>
                    ))}
                  </ol>
                </article>

                <article className={`${styles.infoCard} ${styles.checkCard}`}>
                  <h3 className={styles.cardTitle}>
                    <span className={`${styles.titleDot} ${styles.titleDotCheck}`} aria-hidden="true" />
                    {i18nT("a_verifier_8f5f7255")}{" "}</h3>
                  <ul className={styles.list}>
                    {(selectedArticle.checks?.length ? selectedArticle.checks : selectedArticle.pitfalls ?? [])
                      .slice(0, 4)
                      .map((item, idx) => (
                        <li key={idx}>{renderStrongParts(item)}</li>
                      ))}
                  </ul>
                </article>

                <article className={`${styles.infoCard} ${styles.focusCard}`}>
                  <h3 className={styles.cardTitle}>
                    <span className={`${styles.titleDot} ${styles.titleDotReflex}`} aria-hidden="true" />
                    {i18nT("le_bon_reflexe_c5102b05")}{" "}</h3>
                  <ul className={styles.list}>
                    {focusItems.map((item, idx) => (
                      <li key={idx}>{renderStrongParts(item)}</li>
                    ))}
                  </ul>
                </article>
              </div>

              {selectedSectionPremium ? (
                <div className={styles.linksRow}>
                  <Link
                    href="/dashboard?panel=contact&panelSource=gps"
                    className={`${styles.primaryLink} ${styles.premiumLink}`}
                    onClick={() => rememberPanelLink("/dashboard?panel=contact&panelSource=gps")}
                  >
                    {i18nT("nous_contacter_pour_premium_149750a6")}{" "}<span aria-hidden="true">→</span>
                  </Link>
                </div>
              ) : selectedArticle.links && selectedArticle.links.length > 0 ? (
                <div className={styles.linksRow}>
                  {selectedArticle.links.slice(0, 4).map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      className={styles.primaryLink}
                      onClick={() => rememberPanelLink(link.href)}
                    >
                      {link.label} <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
