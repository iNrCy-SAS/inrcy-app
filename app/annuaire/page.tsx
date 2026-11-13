import Image from "next/image";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getInrDirectoryResult } from "@/lib/inrDirectoryQuery";
import styles from "./directory.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("public.directory_metadata_title"), alternates: { canonical: "https://inrcy.com/annuaire/" }, robots: { index: false, follow: true } };
}

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations();
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
  if (params.has("inrcy_page")) params.set("page", params.get("inrcy_page") || "1");
  const host = (await headers()).get("host") || "";
  const localOrigin = process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1):\d+$/.test(host) ? `http://${host}` : undefined;
  let result: Awaited<ReturnType<typeof getInrDirectoryResult>> | null = null;
  try { result = await getInrDirectoryResult(params, localOrigin); } catch { /* Show an explicit unavailable state, never a fake empty listing. */ }
  const professions = result?.facets.professions || [];
  const sectors = [...new Set(professions.map(job => job.sector))];
  const pageHref = (page: number) => { const next = new URLSearchParams(params); next.set("page", String(page)); next.delete("inrcy_page"); return `/annuaire?${next}`; };

  return <div className={styles.page}>
    <header className={styles.nav}><a href="https://inrcy.com/" className={styles.brand}>iNrCy<span>{t("dashboard.topbar.brandTag")}</span></a><nav aria-label={t("public.directory_navigation")}><a href="https://inrcy.com/">{t("shell.accueil_a8ff8fd2")}</a><a href="https://inrcy.com/nos-outils/">{t("public.directory_tools")}</a><a href="https://inrcy.com/nos-packs/">{t("public.directory_plans")}</a><a href="/annuaire" aria-current="page">iNr’Annuaire</a></nav><a href="/dashboard" className={styles.dashboardLink}>{t("public.directory_my_app")} ↗</a></header>
    <main className={styles.main}>
      {localOrigin ? <div className={styles.localNote}>{t("public.directory_local_preview")}</div> : null}
      <section className={styles.hero} aria-labelledby="directory-title"><span className={styles.eyebrow}>{t("public.directory_network")}</span><h1 id="directory-title">{t("public.directory_heading")}<br />{t("public.directory_heading_nearby")}</h1><p>{t.rich("public.directory_intro", { line: () => <br className={styles.desktopBreak} /> })}</p></section>
      <form className={styles.filters} role="search" action="/annuaire" method="get"><label className={styles.query}>{t("public.directory_search_label")}<input type="search" name="q" defaultValue={params.get("q") || ""} placeholder={t("public.directory_search_placeholder")} /></label><label>{t("public.directory_profession_label")}<select name="metier" defaultValue={params.get("metier") || ""}><option value="">{t("public.directory_all_professions")}</option>{sectors.map(sector => <optgroup key={sector} label={sector}>{professions.filter(job => job.sector === sector).map(job => <option key={job.slug} value={job.slug}>{job.label} ({job.count})</option>)}</optgroup>)}</select></label><label>{t("public.directory_city_label")}<select name="ville" defaultValue={params.get("ville") || ""}><option value="">{t("public.directory_all_cities")}</option>{result?.facets.cities.map(city => <option key={city.slug} value={city.slug}>{city.label} ({city.count})</option>)}</select></label><label>{t("public.directory_region_label")}<select name="region" defaultValue={params.get("region") || ""}><option value="">{t("public.directory_all_regions")}</option>{result?.facets.regions.map(region => <option key={region.slug} value={region.slug}>{region.label} ({region.count})</option>)}</select></label><button type="submit">{t("mails.rechercher_91f7d3e9")} <span aria-hidden="true">↗</span></button></form>
      <div className={styles.resultsHeader}><p aria-live="polite"><strong>{result?.total ?? "—"}</strong> {t("public.directory_listed_professionals", { count: result?.total ?? 2 })}</p><span>{t("public.directory_profession_catalogue")}</span>{["q", "metier", "ville", "region"].some(key => params.get(key)) ? <a href="/annuaire">{t("public.directory_clear_filters")}</a> : null}</div>
      {!result ? <div className={styles.empty} role="alert"><h2>{t("public.directory_unavailable")}</h2><p>{t("public.directory_retry_later")}</p></div> : result.items.length ? <section className={styles.grid} aria-label={t("public.directory_professionals")}><>{result.items.map((company, index) => <article key={company.slug} className={styles.card}>
        <div className={styles.cardTop}><span>{t("public.directory_professional_badge")}</span><span className={styles.mark} aria-hidden="true">iN</span></div><h2>{company.companyName}</h2><p className={styles.profession}>{company.profession}</p><p className={styles.location} title={[company.city, company.department, company.region].filter(Boolean).join(" · ")}>⌖ {[company.city, company.department, company.region].filter(Boolean).join(" · ")}</p>
        <a href={`${company.url}?src=directory`} className={styles.qrLink} aria-label={t("public.directory_open_company_badge", { company: company.companyName })}><Image unoptimized src={company.qrUrl} alt={t("public.directory_company_qr", { company: company.companyName })} width={140} height={140} loading={index < 4 ? "eager" : "lazy"} /><span>{t("public.directory_scan")}</span></a>
        <a href={`${company.url}?src=directory`} className={styles.cardLink}>{t("public.directory_open_badge")} <span aria-hidden="true">↗</span></a>
      </article>)}</></section> : <div className={styles.empty}><h2>{t("public.directory_empty")}</h2><p>{t("public.directory_empty_hint")}</p><a href="/annuaire">{t("public.directory_view_all")}</a></div>}
      {result && (result.page > 1 || result.hasNext) ? <nav className={styles.pagination} aria-label={t("public.directory_pagination")}>{result.page > 1 ? <a href={pageHref(result.page - 1)}>← {t("shell.precedent_a527f171")}</a> : null}<span aria-current="page">{t("public.directory_page", { page: result.page })}</span>{result.hasNext ? <a href={pageHref(result.page + 1)}>{t("shell.suivant_596d29a7")} →</a> : null}</nav> : null}
      <aside className={styles.join}><div><span className={styles.eyebrow}>{t("public.directory_professional_question")}</span><h2>{t("public.directory_join_heading")}</h2><p>{t("public.directory_join_description")}</p></div><a href="/dashboard?panel=inr_directory">{t("public.directory_manage_presence")} ↗</a></aside>
      <p className={styles.note}>{t("public.directory_listing_note")}</p>
    </main><footer className={styles.footer}><a href="https://inrcy.com/">iNrCy</a><span>{t("public.directory_footer")}</span><a href="https://inrcy.com/contact/">{t("dashboard.drawer.titles.contact")} ↗</a></footer>
  </div>;
}
