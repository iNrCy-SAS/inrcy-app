import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  buildInrSearchPublicUrl,
  buildInrSearchSectorUrl,
  getInrSearchPublicOrigin,
  listInrSearchCompaniesBySector,
  normalizeInrSearchDirectorySlug,
} from "@/lib/inrSearchPublic";
import { serializeInrSearchJsonLd } from "@/lib/inrSearchSeo";
import styles from "../../directory.module.css";

type PageProps = { params: Promise<{ secteur: string }> };
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const i18nT = await getTranslations("public");
  const { secteur } = await params;
  const normalizedSecteur = normalizeInrSearchDirectorySlug(secteur);
  const companies = await listInrSearchCompaniesBySector(normalizedSecteur);
  if (!companies.length) return { title: i18nT("secteur_introuvable_inr_search_6cb94164"), robots: { index: false, follow: false } };
  const label = companies[0].sectorLabel;
  const canonical = buildInrSearchSectorUrl(normalizedSecteur);
  const title = i18nT("value_entreprises_et_professionnels_inr_search_dab17ebb", { value0: label });
  const description = i18nT("decouvrez_les_entreprises_du_secteur_value_ea2137c7", { value0: label });
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", locale: i18nT("fr_fr_5540fd60"), url: canonical, siteName: i18nT("inrcy_ef95fe0e"), title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function SecteurPage({ params }: PageProps) {
  const i18nT = await getTranslations("public");
  const { secteur } = await params;
  const normalizedSecteur = normalizeInrSearchDirectorySlug(secteur);
  if (!normalizedSecteur) notFound();
  if (secteur !== normalizedSecteur) permanentRedirect(`/secteurs/${normalizedSecteur}`);

  const companies = await listInrSearchCompaniesBySector(normalizedSecteur);
  if (!companies.length) notFound();
  const label = companies[0].sectorLabel;
  const canonical = buildInrSearchSectorUrl(normalizedSecteur);
  const origin = getInrSearchPublicOrigin();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": canonical,
        name: `Entreprises du secteur ${label}`,
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
          { "@type": "ListItem", position: 2, name: "Secteurs", item: `${origin}/secteurs` },
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
        <div className={styles.breadcrumbs}><Link href="/entreprises">{i18nT("entreprises_4b0c7c83")}</Link><span>›</span><Link href="/secteurs">{i18nT("secteurs_b01b1d0f")}</Link><span>›</span><span>{label}</span></div>
        <span className={styles.kicker}>{i18nT("secteur_d_activite_04b6a420")}</span>
        <h1>{label}</h1>
        <p>{i18nT("decouvrez_les_entreprises_et_les_differents_444e4ad9", { value0: label })}</p>
      </header>
      <section className={styles.grid}>
        {companies.map((company) => (
          <Link className={styles.card} href={`/entreprises/${company.slug}`} key={company.slug}>
            <div className={styles.meta}>{[company.profession, company.city].filter(Boolean).join(" · ")}</div>
            <h2>{company.pageTitle}</h2>
            <p>{company.pageDescription}</p>
            <span>{i18nT("decouvrir_l_entreprise_435e69e8")}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
