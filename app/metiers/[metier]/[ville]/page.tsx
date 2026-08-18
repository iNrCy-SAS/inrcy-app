import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  buildInrSearchProfessionUrl,
  buildInrSearchPublicUrl,
  getInrSearchPublicOrigin,
  listInrSearchCompaniesByProfession,
  normalizeInrSearchDirectorySlug,
} from "@/lib/inrSearchPublic";
import { serializeInrSearchJsonLd } from "@/lib/inrSearchSeo";
import styles from "../../../directory.module.css";

type PageProps = { params: Promise<{ metier: string; ville: string }> };
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const i18nT = await getTranslations("public");
  const { metier, ville } = await params;
  const normalizedMetier = normalizeInrSearchDirectorySlug(metier);
  const normalizedVille = normalizeInrSearchDirectorySlug(ville);
  const companies = await listInrSearchCompaniesByProfession(normalizedMetier, normalizedVille);
  if (!companies.length) return { title: i18nT("page_introuvable_inr_search_a8985247"), robots: { index: false, follow: false } };
  const label = companies[0].profession;
  const city = companies[0].city;
  const canonical = buildInrSearchProfessionUrl(normalizedMetier, normalizedVille);
  const title = i18nT("value_a_value_inr_search_30f66798", { value0: label, value1: city });
  const description = i18nT("decouvrez_les_professionnels_value_a_value_ca1614f5", { value0: label.toLowerCase(), value1: city });
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", locale: i18nT("fr_fr_5540fd60"), url: canonical, siteName: i18nT("inrcy_ef95fe0e"), title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function MetierVillePage({ params }: PageProps) {
  const i18nT = await getTranslations("public");
  const { metier, ville } = await params;
  const normalizedMetier = normalizeInrSearchDirectorySlug(metier);
  const normalizedVille = normalizeInrSearchDirectorySlug(ville);
  if (!normalizedMetier || !normalizedVille) notFound();
  if (metier !== normalizedMetier || ville !== normalizedVille) {
    permanentRedirect(`/metiers/${normalizedMetier}/${normalizedVille}`);
  }

  const companies = await listInrSearchCompaniesByProfession(normalizedMetier, normalizedVille);
  if (!companies.length) notFound();
  const label = companies[0].profession;
  const city = companies[0].city;
  const canonical = buildInrSearchProfessionUrl(normalizedMetier, normalizedVille);
  const origin = getInrSearchPublicOrigin();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": canonical,
        name: `${label} à ${city}`,
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
          { "@type": "ListItem", position: 3, name: label, item: buildInrSearchProfessionUrl(normalizedMetier) },
          { "@type": "ListItem", position: 4, name: city, item: canonical },
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
        <div className={styles.breadcrumbs}><Link href="/entreprises">{i18nT("entreprises_4b0c7c83")}</Link><span>›</span><Link href="/metiers">{i18nT("metiers_6a11606f")}</Link><span>›</span><Link href={`/metiers/${normalizedMetier}`}>{label}</Link><span>›</span><span>{city}</span></div>
        <span className={styles.kicker}>{i18nT("professionnels_locaux_5e7f5761")}</span>
        <h1>{label} à {city}</h1>
        <p>{i18nT("decouvrez_les_entreprises_specialisees_en_value_1cfda15e", { value0: label.toLowerCase(), value1: city })}</p>
      </header>
      <section className={styles.grid}>
        {companies.map((company) => (
          <Link className={styles.card} href={`/entreprises/${company.slug}`} key={company.slug}>
            <div className={styles.meta}>{[company.sectorLabel, company.city].filter(Boolean).join(" · ")}</div>
            <h2>{company.pageTitle}</h2>
            <p>{company.pageDescription}</p>
            <span>{i18nT("decouvrir_l_entreprise_435e69e8")}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
