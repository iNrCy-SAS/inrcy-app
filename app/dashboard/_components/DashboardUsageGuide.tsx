"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "@/lib/dashboardEdition";
import type { GpsArticle, GpsMessageKey } from "../gps/noticeContent";
import {
  HELP_GOALS, HELP_SETUP, getHelpArticles,
  getHelpGoalTools, getHelpArticleDestination, normalizeHelpSearch, type HelpGoal, type HelpSetup,
} from "./dashboardUsageGuideModel";
import DashboardToolArtwork from "./DashboardToolArtwork";
import DashboardMobileSelect from "./DashboardMobileSelect";
import styles from "./DashboardUsageGuide.module.css";

export type DashboardUsageGuideProps = {
  edition: DashboardEdition;
  metaPilotEnabled: boolean;
  inrAgentEnabled: boolean;
  progress: { channels: number; dna: number; ai: number; connected: number; total: number; uiBalance: number; isActive: boolean };
  onNavigate: (href: string) => void;
};

type Theme = HelpGoal | HelpSetup | "landmarks" | "start";
type IconName = Exclude<Theme, "start"> | "search";
type ContentCard = { title: string; items: string[]; numbered?: boolean };
type ThemeContent = { title: string; subtitle: string; intro: string; cards: ContentCard[] };
const SETUP_HREFS: Record<HelpSetup, string> = {
  channels: "/dashboard?helpAction=channels", dna: "/dashboard/adn-entreprise", ai: "/dashboard/configuration-ia",
};
const TONES: Record<Theme, string> = {
  start: "blue",
  channels: "cyan", dna: "purple", ai: "pink", publish: "cyan", media: "blue", grow: "pink",
  reviews: "gold", contacts: "cyan", stats: "purple", landmarks: "blue",
};
const ARTWORK = { publish: "rocket", media: "studio", grow: "mail", reviews: "reputation", contacts: "contacts" } as const;
// Select useful GPS content for each theme; the help is one sheet per task, not an article catalogue.
const THEME_SOURCES: Record<Theme, readonly string[]> = {
  start: ["demarrer-express", "problemes-express"],
  channels: ["canaux-express", "canaux-threads", "problemes-express"],
  dna: ["demarrer-express", "demarrer-rangement"],
  ai: ["demarrer-express", "booster-express", "problemes-express"],
  publish: ["booster-express", "booster-bilan"],
  media: [],
  grow: ["propulser-express", "fideliser-express"],
  reviews: ["canaux-express", "conseils-express"],
  contacts: ["crm-express", "agenda-express", "inrsend-express"],
  stats: ["inrstats-express", "booster-bilan"],
  landmarks: ["generateur-express"],
};
const SOURCE_IDS = new Set(Object.values(THEME_SOURCES).flat());
const THEMES: readonly Theme[] = ["start", ...HELP_SETUP, ...HELP_GOALS, "landmarks"];
const completion = (value: number) => Math.max(0, Math.min(100, Math.round(value || 0)));

function GuideIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "channels" ? <><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="3" width="6" height="6" rx="1.5" /><rect x="9" y="15" width="6" height="6" rx="1.5" /><path d="M6 9v3h12V9M12 12v3" /></> : null}
    {name === "dna" ? <><path d="M7 3c0 8 10 10 10 18M17 3C17 11 7 13 7 21M8 5h8M9 9h6M9 15h6M8 19h8" /></> : null}
    {name === "ai" ? <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></> : null}
    {name === "publish" ? <><path d="M14 4c2-1 4-1 6-1 0 2 0 4-1 6l-7 7-5-5 7-7ZM7 11l-4 1 4-6 5-1M12 16l-1 5 6-4 1-5M7 16l-3 4" /><circle cx="16" cy="7" r="1.5" /></> : null}
    {name === "media" ? <><rect x="3" y="5" width="18" height="15" rx="3" /><circle cx="8" cy="10" r="1.5" /><path d="m4 17 5-4 4 3 3-6 4 7M9 2h6" /></> : null}
    {name === "grow" ? <><path d="m3 10 14-6v16L3 14v-4ZM7 15l2 6h4l-2-8M20 8l2-2M20 12h3M20 16l2 2" /></> : null}
    {name === "reviews" ? <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /> : null}
    {name === "contacts" ? <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></> : null}
    {name === "stats" ? <><path d="M4 3v18h17M8 16v-4M13 16V8M18 16V5M7 8l5-4 4 1 4-3" /></> : null}
    {name === "landmarks" ? <path d="m13.5 3-8 10H11l-1 8 8-11h-5.5l1-7Z" /> : null}
    {name === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : null}
  </svg>;
}

function RichText({ text }: { text: string }) {
  return <>{text.split(/(\*\*.*?\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</>;
}

export default function DashboardUsageGuide({ edition, metaPilotEnabled, inrAgentEnabled, progress, onNavigate }: DashboardUsageGuideProps) {
  const t = useTranslations("dashboard.helpCenter");
  const dashboardT = useTranslations("dashboard");
  const gpsT = useTranslations("gps");
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [selection, setSelection] = useState<Theme>("start");
  const [query, setQuery] = useState("");
  const articles = useMemo(() => new Map(getHelpArticles(edition, metaPilotEnabled)
    .filter(({ article }) => SOURCE_IDS.has(article.id))
    .map(({ article }) => {
      const translate = (key: GpsMessageKey) => gpsT(key as never);
      const content: GpsArticle = {
        ...article, title: translate(article.title), intro: translate(article.intro),
        keywords: article.keywords.map(translate), steps: article.steps.map(translate),
        checks: article.checks?.map(translate), pitfalls: article.pitfalls?.map(translate),
        faq: article.faq?.map(({ q, a }) => ({ q: translate(q), a: translate(a) })),
      };
      return [article.id, content] as const;
    })), [edition, metaPilotEnabled, gpsT]);
  const source = (articleId: string) => articles.get(articleId);
  const items = (articleId: string, field: "steps" | "checks" | "pitfalls", indices: readonly number[]) =>
    indices.map(index => source(articleId)?.[field]?.[index]).filter((value): value is string => Boolean(value));
  const intro = (articleId: string) => source(articleId)?.intro ?? "";
  const card = (title: string, content: string[], numbered = false): ContentCard => ({ title, items: content.filter(Boolean), numbered });
  const steps = (content: string[]) => card(t("steps"), content, true);
  const checks = (content: string[]) => card(t("checks"), content);
  const reflexes = (content: string[]) => card(t("pitfalls"), content);
  const goalContent = (goal: HelpGoal, cards: ContentCard[]): ThemeContent => ({
    title: t(`goals.${goal}.title`), subtitle: t(`goals.${goal}.subtitle`), intro: t(`goals.${goal}.intro`),
    cards: [steps([1, 2, 3].map(step => t(`goals.${goal}.steps.step${step}`))), ...cards],
  });
  const content: Record<Theme, ThemeContent> = {
    start: { title: t("setupTitle"), subtitle: t("setupSubtitle"), intro: t("intro"), cards: [
      checks(items("demarrer-express", "checks", [0, 2, 3])),
    ] },
    channels: { title: t("channels.title"), subtitle: t("channels.body"), intro: intro("canaux-express"), cards: [
      steps(items("canaux-express", "steps", [0, 1, 2])),
      checks(items("canaux-express", "checks", [0, 1, 2])),
      reflexes(items("canaux-express", "pitfalls", [0, 1])),
      card(source("canaux-threads")?.title ?? source("problemes-express")?.title ?? t("overview"), source("canaux-threads")
        ? [intro("canaux-threads"), ...items("canaux-threads", "checks", [0])]
        : [intro("problemes-express"), ...items("problemes-express", "checks", [0])]),
    ] },
    dna: { title: t("dna.title"), subtitle: t("dna.body"), intro: intro("demarrer-express"), cards: [
      steps(items("demarrer-express", "steps", [0, 2, 3])),
      checks(items("demarrer-express", "checks", [0, 2, 3])),
      reflexes(items("demarrer-express", "pitfalls", [0, 1])),
      card(source("demarrer-rangement")?.title ?? t("overview"), [intro("demarrer-rangement"), ...items("demarrer-rangement", "pitfalls", [0])]),
    ] },
    ai: { title: t("ai.title"), subtitle: t("ai.body"), intro: t("setupSubtitle"), cards: [
      steps([
        gpsT("personnaliser_configuration_ia_ton_style_facon_2fcb8d45"),
        gpsT("startup_step_configure_ai_20260905"),
        gpsT("verifier_le_texte_le_media_le_652d37d4"),
      ]),
      checks([gpsT("configuration_ia_reflete_bien_le_style_b90fdac8"), ...items("demarrer-express", "checks", [0, 3])]),
      reflexes([gpsT("verifier_mon_activite_mon_profil_et_c02fc29a"), ...items("problemes-express", "pitfalls", [0])]),
      card(t("goals.publish.title"), [t("goals.publish.intro"), ...items("booster-express", "checks", [2]), ...items("booster-express", "pitfalls", [2])]),
    ] },
    publish: goalContent("publish", [
      checks(items("booster-express", "checks", [0, 1, 2])),
      reflexes([...items("booster-express", "pitfalls", [2]), ...items("booster-bilan", "pitfalls", [0])]),
      card(source("booster-bilan")?.title ?? t("overview"), [intro("booster-bilan"), ...items("booster-bilan", "checks", [2])]),
    ]),
    media: { title: t("goals.media.title"), subtitle: t("goals.media.subtitle"), intro: t("goals.media.intro"), cards: [
      steps([t("goals.media.steps.step1"), t("mediaDetails.brief")]),
      checks([t("mediaDetails.format"), t("mediaDetails.engine")]),
      card(t("mediaDetails.referencesTitle"), [t("mediaDetails.references"), t("mediaDetails.dna")]),
      card(t("mediaDetails.finishTitle"), [t("mediaDetails.review"), t("mediaDetails.save")]),
    ] },
    grow: goalContent("grow", [
      checks([...items("propulser-express", "checks", [0, 1, 3]), ...items("fideliser-express", "checks", [1])]),
      reflexes([...items("propulser-express", "pitfalls", [0]), ...items("fideliser-express", "pitfalls", [1])]),
      card(source("fideliser-express")?.title ?? t("overview"), [intro("fideliser-express"), ...items("fideliser-express", "checks", [3])]),
    ]),
    reviews: goalContent("reviews", [
      checks(items("canaux-express", "checks", [0, 1, 2])),
      reflexes(items("conseils-express", "checks", [2, 3])),
      card(t("goals.reviews.subtitle"), [gpsT("google_business_se_gere_dans_e_d7e3e702"), gpsT("piloter_les_avis_depuis_reputation_et_b8fd5cd0"), ...items("conseils-express", "pitfalls", [1])]),
    ]),
    contacts: goalContent("contacts", [
      checks([...items("crm-express", "checks", [0, 2]), ...items("agenda-express", "checks", [1, 2])]),
      reflexes(items("crm-express", "pitfalls", [0, 1])),
      card(source("inrsend-express")?.title ?? t("overview"), [intro("inrsend-express"), ...items("inrsend-express", "checks", edition === "standard" ? [1, 2] : [2, 3])]),
    ]),
    stats: goalContent("stats", [
      checks(items("inrstats-express", "checks", [0, 1, 2, 3])),
      reflexes([t("goals.stats.steps.step3"), ...items("inrstats-express", "pitfalls", [0])]),
      card(source("booster-bilan")?.title ?? t("overview"), [intro("booster-bilan"), ...items("booster-bilan", "checks", [2])]),
    ]),
    landmarks: { title: t("landmarksTitle"), subtitle: t("landmarksBody"), intro: "", cards: [
      card(t("setupTitle"), [t("powerBody"), `**${t("generatorTitle")}** ${t("generatorBody")}`]),
      card(t("inertiaTitle"), [dashboardT("usageGuide.inertiaBody")]),
      card(t("generatorSettings"), items("generateur-express", "steps", [1, 2]).concat(items("generateur-express", "checks", [0]))),
      card(dashboardT("topbar.myAccount"), [
        ["abonnement", "factures", "parrainage", "preferences", "legal", "rgpd"].map(key => dashboardT(`accountTabs.${key}`)).join(" · "),
        `**${dashboardT("topbar.notifications")}** ${dashboardT("notifications.subtitle")}`,
      ]),
    ] },
  };
  const current = content[selection];
  const goal = HELP_GOALS.find(key => key === selection);
  const setup = HELP_SETUP.find(key => key === selection);
  const tools = goal ? getHelpGoalTools(goal, edition, inrAgentEnabled) : [];
  const searchTerms = normalizeHelpSearch(query).split(/\s+/).filter(Boolean);
  const matchingThemes = THEMES.filter(theme => {
    const sheet = content[theme];
    const sources = THEME_SOURCES[theme].flatMap(key => source(key) ? [source(key)!] : []);
    const searchable = normalizeHelpSearch([
      sheet.title, sheet.subtitle, sheet.intro, ...sheet.cards.flatMap(item => [item.title, ...item.items]),
      ...sources.flatMap(article => [...article.keywords, ...(article.faq ?? []).flatMap(({ q, a }) => [q, a])]),
    ].join(" "));
    return searchTerms.every(term => searchable.includes(term));
  });
  // Keep the open sheet named in the selector while search narrows its destinations.
  const mobileThemes = matchingThemes.includes(selection) ? matchingThemes : [selection, ...matchingThemes];
  const faq = THEME_SOURCES[selection].flatMap(key => source(key)?.faq ?? [])
    .filter((item, index, all) => all.findIndex(other => other.q === item.q) === index);
  const visibleCards = faq.length ? [...current.cards, card(t("faq"), faq.map(({ q, a }) => `**${q}**\n${a}`))] : current.cards;
  const select = (next: Theme) => {
    setSelection(next);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  };
  const navigate = (href: string) => {
    const destination = getHelpArticleDestination(href);
    onNavigate(isDashboardDestinationAllowedForEdition(destination, edition) ? destination : "/dashboard?panel=abonnement");
  };
  const renderTheme = (theme: Theme) => matchingThemes.includes(theme) ? <button key={theme} type="button" className={styles.navItem} data-tone={TONES[theme]} aria-current={selection === theme ? "page" : undefined} onClick={() => select(theme)}>
    <span className={styles.icon}><GuideIcon name={theme === "start" ? "landmarks" : theme} /></span><span>{content[theme].title}</span><span aria-hidden="true">›</span>
  </button> : null;

  return <div className={styles.guide} data-testid="dashboard-unified-help">
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label={t("title")}>
        <DashboardMobileSelect
          value={selection}
          options={mobileThemes.map(theme => ({
            value: theme,
            label: content[theme].title,
            disabled: !matchingThemes.includes(theme),
            icon: <span className={styles.mobileThemeIcon} data-tone={TONES[theme]}><GuideIcon name={theme === "start" ? "landmarks" : theme} /></span>,
          }))}
          onChange={select}
          ariaLabel={t("title")}
          controls={`${id}-sheet`}
        />
        <label className={styles.search}><GuideIcon name="search" /><input type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
        }} /></label>
        {!matchingThemes.length ? <p className={styles.mobileEmpty} role="status">{t("noResults")}</p> : null}
        <nav className={styles.navigation} aria-label={t("title")}>
          {renderTheme("start")}
          <div className={styles.setup}>{HELP_SETUP.map(renderTheme)}</div>
          <div className={styles.goals}>{HELP_GOALS.map(renderTheme)}</div>
          {renderTheme("landmarks")}
          {!matchingThemes.length ? <p className={styles.empty} role="status">{t("noResults")}</p> : null}
        </nav>
      </aside>
      <section id={`${id}-sheet`} className={styles.main} data-tone={TONES[selection]} aria-labelledby={`${id}-detail`}>
        <div className={styles.mainHeading}>
          <span className={styles.largeIcon}><GuideIcon name={selection === "start" ? "landmarks" : selection} /></span>
          <div><h2 id={`${id}-detail`} tabIndex={-1} ref={headingRef}>{current.title}</h2><p>{current.subtitle}</p></div>
          {goal && goal !== "stats" ? <DashboardToolArtwork kind={ARTWORK[goal]} className={styles.headerArtwork} /> : null}
        </div>
        <div className={styles.detail}>
          {current.intro ? <p className={styles.detailIntro}><RichText text={current.intro} /></p> : null}
          {setup ? <div className={styles.setupStatus}><span>{setup === "channels" ? t("connected", { connected: progress.connected, total: progress.total }) : t(completion(progress[setup]) === 100 ? "completed" : "continue")}</span><strong>{completion(progress[setup])}%</strong><span className={styles.gauge} role="progressbar" aria-label={t(`${setup}.title`)} aria-valuenow={completion(progress[setup])} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${completion(progress[setup])}%` }} /></span></div> : null}
          <div className={styles.cardGrid}>
            {selection === "start" ? HELP_SETUP.map((key, index) => {
              const value = completion(progress[key]);
              const tip = key === "channels" ? items("canaux-express", "checks", [1])[0] : key === "dna" ? items("demarrer-express", "steps", [3])[0] : gpsT("startup_step_configure_ai_20260905");
              return <article className={styles.startCard} key={key} data-tone={TONES[key]}>
                <div className={styles.cardHeading}><span className={styles.stepNumber}>{index + 1}</span><h3>{t(`${key}.title`)}</h3><span className={styles.completion}>{key === "channels" ? t("connected", { connected: progress.connected, total: progress.total }) : t(value === 100 ? "completed" : "continue")}</span></div>
                <p>{t(`${key}.body`)}</p><p className={styles.tip}><RichText text={tip ?? ""} /></p>
                <div className={styles.startBottom}><span className={styles.gauge} role="progressbar" aria-label={t(`${key}.title`)} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></span><strong>{value}%</strong><button type="button" className={styles.toolButton} onClick={() => navigate(SETUP_HREFS[key])}>{t(`${key}.action`)} <span aria-hidden="true">↗</span></button></div>
              </article>;
            }) : null}
            {visibleCards.map((item, index) => <article className={styles.infoCard} key={`${selection}-${index}`}>
              <div className={styles.cardHeading}><span className={styles.icon}><GuideIcon name={item.numbered ? "publish" : index === 1 ? "channels" : selection === "start" ? "landmarks" : selection} /></span><h3>{item.title}</h3>{selection === "landmarks" && index === 0 ? <span className={styles.statusPoint} data-active={progress.isActive} aria-hidden="true" /> : null}</div>
              {item.numbered ? <ol className={styles.instructions}>{item.items.map((text, step) => <li key={step}><span className={styles.stepNumber}>{step + 1}</span><p><RichText text={text} /></p></li>)}</ol> : <ul className={styles.checkList}>{item.items.map((text, entry) => <li key={entry}><p><RichText text={text} /></p></li>)}</ul>}
              {selection === "landmarks" && index === 1 ? <strong className={styles.balance}>{t("balance", { value: progress.uiBalance.toLocaleString() })}</strong> : null}
            </article>)}
          </div>
        </div>
        {goal || setup || selection === "landmarks" ? <div className={styles.toolActions}>
          {tools.map(tool => <button type="button" className={`${styles.toolButton}${tool.agentImage ? ` ${styles.agent}` : ""}`} key={tool.href} onClick={() => navigate(tool.premium ? "/dashboard?panel=abonnement" : tool.href)}>
            {tool.agentImage ? <Image src={tool.agentImage} width={32} height={32} alt="" /> : null}<span>{tool.label}{tool.premium ? <small>{t("premium")}</small> : null}</span><span aria-hidden="true">{tool.premium ? "◇" : "↗"}</span>
          </button>)}
          {setup ? <button type="button" className={styles.toolButton} onClick={() => navigate(SETUP_HREFS[setup])}>{t(`${setup}.action`)} <span aria-hidden="true">↗</span></button> : null}
          {selection === "landmarks" ? <>
            <button type="button" className={styles.toolButton} onClick={() => navigate("/dashboard?panel=boutique")}>{t("shop")} <span aria-hidden="true">↗</span></button>
            <button type="button" className={styles.toolButton} onClick={() => navigate("/dashboard?helpAction=generator-settings")}>{t("generatorSettings")} <span aria-hidden="true">↗</span></button>
            <button type="button" className={styles.toolButton} onClick={() => navigate("/dashboard/stats")}>iNr’Stats <span aria-hidden="true">↗</span></button>
            <button type="button" className={styles.toolButton} onClick={() => navigate("/dashboard?panel=compte")}>{dashboardT("topbar.myAccount")} <span aria-hidden="true">↗</span></button>
            <button type="button" className={styles.toolButton} onClick={() => navigate("/dashboard?panel=notifications")}>{dashboardT("topbar.notifications")} · {dashboardT("notifications.settings")} <span aria-hidden="true">↗</span></button>
          </> : null}
        </div> : null}
      </section>
    </div>
  </div>;
}
