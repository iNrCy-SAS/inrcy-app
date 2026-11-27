export const CYCLICOM_TERMS_VERSION = "cyclicom-echeances-v1";

type CyclicomOffer = {
  slug: string;
  label: string;
  totalCents: number;
  maxInstallments: 1 | 3;
  livePriceId: string;
  sandboxPriceEnv: string;
};

const offers: Record<string, CyclicomOffer> = {
  "one-page": {
    slug: "one-page",
    label: "Site vitrine One page",
    totalCents: 40_000,
    maxInstallments: 1,
    livePriceId: "price_1UgKeKAluLVg8J6jKl24k7I1",
    sandboxPriceEnv: "CYCLICOM_TEST_PRICE_ONE_PAGE",
  },
  "5-pages": {
    slug: "5-pages",
    label: "Site vitrine 5 pages / onglets",
    totalCents: 120_000,
    maxInstallments: 3,
    livePriceId: "price_1UgKeOAluLVg8J6jVDiWBh3I",
    sandboxPriceEnv: "CYCLICOM_TEST_PRICE_5_PAGES",
  },
  "10-pages": {
    slug: "10-pages",
    label: "Site vitrine 10 pages",
    totalCents: 200_000,
    maxInstallments: 3,
    livePriceId: "price_1UgKeRAluLVg8J6j4OLCdsoy",
    sandboxPriceEnv: "CYCLICOM_TEST_PRICE_10_PAGES",
  },
};

export function getCyclicomOffer(slug: string): CyclicomOffer | null {
  return Object.hasOwn(offers, slug) ? offers[slug] : null;
}

export function getCyclicomInstallments(offer: CyclicomOffer, count: number): number[] | null {
  if (!Number.isInteger(count) || count < 1 || count > offer.maxInstallments) return null;

  // Keep later installments equal and allocate any cent remainder to the first.
  const regular = Math.floor(offer.totalCents / count);
  return [offer.totalCents - regular * (count - 1), ...Array<number>(count - 1).fill(regular)];
}
