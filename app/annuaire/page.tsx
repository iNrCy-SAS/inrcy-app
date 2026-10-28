import Image from "next/image";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getInrDirectoryResult } from "@/lib/inrDirectoryQuery";
import styles from "./directory.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "iNr’Annuaire — Trouvez le bon professionnel", alternates: { canonical: "https://inrcy.com/annuaire/" }, robots: { index: false, follow: true } };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    <header className={styles.nav}><a href="https://inrcy.com/" className={styles.brand}>iNrCy<span>Générateur de visibilité</span></a><nav aria-label="Navigation de l’annuaire"><a href="https://inrcy.com/">Accueil</a><a href="https://inrcy.com/nos-outils/">Nos outils</a><a href="https://inrcy.com/nos-packs/">Nos packs</a><a href="/annuaire" aria-current="page">iNr’Annuaire</a></nav><a href="/dashboard" className={styles.dashboardLink}>Mon application ↗</a></header>
    <main className={styles.main}>
      {localOrigin ? <div className={styles.localNote}>APERÇU LOCAL · Nouvelle version de l’annuaire</div> : null}
      <section className={styles.hero} aria-labelledby="directory-title"><span className={styles.eyebrow}>LES PROFESSIONNELS DU RÉSEAU iNrCy</span><h1 id="directory-title">Le bon professionnel.<br />Tout près de vous.</h1><p>Un nom, un métier, un lieu. Scannez le QR code ou ouvrez l’iNr’Badge<br className={styles.desktopBreak} /> pour découvrir le professionnel et le contacter.</p></section>
      <form className={styles.filters} role="search" action="/annuaire" method="get"><label className={styles.query}>RECHERCHE<input type="search" name="q" defaultValue={params.get("q") || ""} placeholder="Un métier, une entreprise, un besoin…" /></label><label>MÉTIER<select name="metier" defaultValue={params.get("metier") || ""}><option value="">Tous les métiers</option>{sectors.map(sector => <optgroup key={sector} label={sector}>{professions.filter(job => job.sector === sector).map(job => <option key={job.slug} value={job.slug}>{job.label} ({job.count})</option>)}</optgroup>)}</select></label><label>VILLE<select name="ville" defaultValue={params.get("ville") || ""}><option value="">Toutes les villes</option>{result?.facets.cities.map(city => <option key={city.slug} value={city.slug}>{city.label} ({city.count})</option>)}</select></label><label>RÉGION<select name="region" defaultValue={params.get("region") || ""}><option value="">Toutes les régions</option>{result?.facets.regions.map(region => <option key={region.slug} value={region.slug}>{region.label} ({region.count})</option>)}</select></label><button type="submit">Rechercher <span aria-hidden="true">↗</span></button></form>
      <div className={styles.resultsHeader}><p aria-live="polite"><strong>{result?.total ?? "—"}</strong> professionnels référencés</p><span>Métiers issus du catalogue iNrCy</span>{["q", "metier", "ville", "region"].some(key => params.get(key)) ? <a href="/annuaire">Effacer les filtres</a> : null}</div>
      {!result ? <div className={styles.empty} role="alert"><h2>L’annuaire est momentanément indisponible</h2><p>Réessayez dans quelques instants.</p></div> : result.items.length ? <section className={styles.grid} aria-label="Les professionnels"><>{result.items.map((company, index) => <article key={company.slug} className={styles.card}>
        <div className={styles.cardTop}><span>PROFESSIONNEL iNrCy</span><span className={styles.mark} aria-hidden="true">iN</span></div><h2>{company.companyName}</h2><p className={styles.profession}>{company.profession}</p><p className={styles.location} title={[company.city, company.department, company.region].filter(Boolean).join(" · ")}>⌖ {[company.city, company.department, company.region].filter(Boolean).join(" · ")}</p>
        <a href={`${company.url}?src=directory`} className={styles.qrLink} aria-label={`Ouvrir l’iNr’Badge de ${company.companyName}`}><Image unoptimized src={company.qrUrl} alt={`QR code vers l’iNr’Badge de ${company.companyName}`} width={140} height={140} loading={index < 4 ? "eager" : "lazy"} /><span>Scannez pour faire connaissance</span></a>
        <a href={`${company.url}?src=directory`} className={styles.cardLink}>Ouvrir l’iNr’Badge <span aria-hidden="true">↗</span></a>
      </article>)}</></section> : <div className={styles.empty}><h2>Aucun professionnel pour cette recherche</h2><p>Essayez un autre métier ou élargissez la zone.</p><a href="/annuaire">Voir tous les professionnels</a></div>}
      {result && (result.page > 1 || result.hasNext) ? <nav className={styles.pagination} aria-label="Pagination de l’annuaire">{result.page > 1 ? <a href={pageHref(result.page - 1)}>← Précédent</a> : null}<span aria-current="page">Page {result.page}</span>{result.hasNext ? <a href={pageHref(result.page + 1)}>Suivant →</a> : null}</nav> : null}
      <aside className={styles.join}><div><span className={styles.eyebrow}>VOUS ÊTES PROFESSIONNEL ?</span><h2>Votre prochaine rencontre commence ici.</h2><p>Activez votre présence depuis la bulle iNr’Annuaire de votre application.</p></div><a href="/dashboard?panel=inr_directory">Gérer ma présence ↗</a></aside>
      <p className={styles.note}>Les professionnels choisissent leur présence dans l’annuaire. Leurs fiches sont actualisées depuis leur profil iNrCy.</p>
    </main><footer className={styles.footer}><a href="https://inrcy.com/">iNrCy</a><span>Des professionnels proches. Des échanges plus simples.</span><a href="https://inrcy.com/contact/">Nous contacter ↗</a></footer>
  </div>;
}
