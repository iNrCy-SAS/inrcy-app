import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  buildInrSearchProfessionUrl,
  buildInrSearchPublicUrl,
  getInrSearchPublicOrigin,
  listInrSearchCitiesForProfession,
  listInrSearchCompaniesByProfession,
  normalizeInrSearchDirectorySlug,
} from "@/lib/inrSearchPublic";
import { serializeInrSearchJsonLd } from "@/lib/inrSearchSeo";
import styles from "../../directory.module.css";

type PageProps = { params: Promise<{ metier: string }> };
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const i18nT = await getTranslations("public");
  const { metier } = await params;
  const normalizedMetier = normalizeInrSearchDirectorySlug(metier);
  const companies = await listInrSearchCompaniesByProfession(normalizedMetier);
  if (!companies.length) return { title: i18nT("metier_introuvable_inr_search_654e1b52"), robots: { index: false, follow: false } };
  const label = companies[0].profession;
  const canonical = buildInrSearchProfessionUrl(normalizedMetier);
  const title = i18nT("value_entreprises_et_professionnels_inr_search_dab17ebb", { value0: label });
  const description = i18nT("decouvrez_les_entreprises_value_presentes_sur_2d9fa828", { value0: label.toLowerCase() });
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", locale: i18nT("fr_fr_5540fd60"), url: canonical, siteName: i18nT("inrcy_ef95fe0e"), title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function MetierPage({ params }: PageProps) {
  const i18nT = await getTranslations("public");
  const { metier } = await params;
  const normalizedMetier = normalizeInrSearchDirectorySlug(metier);
  if (!normalizedMetier) notFound();
  if (metier !== normalizedMetier) permanentRedirect(`/metiers/${normalizedMetier}`);

  const [companies, cities] = await Promise.all([
    listInrSearchCompaniesByProfession(normalizedMetier),
    listInrSearchCitiesForProfession(normalizedMetier),
  ]);
  if (!companies.length) notFound();

  const label = companies[0].profession;
  const canonical = buildInrSearchProfessionUrl(normalizedMetier);
  const origin = getInrSearchPublicOrigin();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": canonical,
        name: `${label} sur iNr'Search`,
        url: canonical,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: companies.map((company, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: company.pageTitle,
            url: buildInrSearchPublicUrl(company.slug),
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Entreprises", item: `${origin}/entreprises` },
          { "@type": "ListItem", position: 2, name: "Métiers", item: `${origin}/metiers` },
          { "@type": "ListItem", position: 3, name: label, item: canonical },
        ],
      },
    ],
  };

  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeInrSearchJsonLd(jsonLd) }} />
      <nav className={styles.topbar}>
        <a href="https://inrcy.com"><Image src="/logo-inrcy.png" alt={i18nT("inrcy_ef95fe0e")} width={116} height={46} priority /></a>
        <div className={styles.topbarNav}><Link href="/entreprises">{i18nT("entreprises_4b0c7c83")}</Link><Link href="/metiers">{i18nT("metiers_6a11606f")}</Link><Link href="/secteurs">{i18nT("secteurs_b01b1d0f")}</Link></div>
      </nav>
      <header className={styles.header}>
        <div className={styles.breadcrumbs}><Link href="/entreprises">{i18nT("entreprises_4b0c7c83")}</Link><span>›</span><Link href="/metiers">{i18nT("metiers_6a11606f")}</Link><span>›</span><span>{label}</span></div>
        <span className={styles.kicker}>{i18nT("professionnels_8d94a78e")}</span>
        <h1>{label}</h1>
        <p>{i18nT("decouvrez_les_entreprises_et_professionnels_spec_c9a97472", { value0: label.toLowerCase() })}</p>
      </header>
      {cities.length ? (
        <nav className={styles.filterRow} aria-label={i18nT("villes_21e2b17f")}>
          {cities.map((city) => <Link href={`/metiers/${normalizedMetier}/${city.slug}`} key={city.slug}>{city.label} ({city.count})</Link>)}
        </nav>
      ) : null}
      <section className={styles.grid}>
        {companies.map((company) => (
          <Link className={styles.card} href={`/entreprises/${company.slug}`} key={company.slug}>
            <div className={styles.meta}>{[company.city, company.sectorLabel].filter(Boolean).join(" · ")}</div>
            <h2>{company.pageTitle}</h2>
            <p>{company.pageDescription}</p>
            <span>{i18nT("decouvrir_l_entreprise_435e69e8")}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
