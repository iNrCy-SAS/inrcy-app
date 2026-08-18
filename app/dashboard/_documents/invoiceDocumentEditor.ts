import type { LineItem } from "./docUtils";

export function getInvoicePrintFooterSpacerMm(lineCount: number): number {
  const count = Math.max(1, Number(lineCount) || 1);

  // Page 1 contient le header + les blocs prestataire/client.
  // Au-delà, le tableau continue seul : on recalcule donc l’espace
  // à remplir sur la dernière page pour garder le bloc final en footer.
  if (count <= 28) {
    return Math.max(0, 112 - (count - 1) * 14);
  }

  const firstPageRows = 28;
  const rowsPerNextPage = 42;
  const rowsAfterFirstPage = count - firstPageRows;
  const rowsOnLastPage = ((rowsAfterFirstPage - 1) % rowsPerNextPage) + 1;

  return Math.max(0, 168 - (rowsOnLastPage - 1) * 4.1);
}

export type InvoicePrintPage = {
  includeHeader: boolean;
  includeFooter: boolean;
  lines: LineItem[];
};

export function buildInvoicePrintPages(lines: LineItem[]): InvoicePrintPage[] {
  const safeLines = lines.length ? lines : [];

  /*
   * Pagination print maîtrisée V112.
   * On réserve toujours quelques prestations pour la dernière page avec footer.
   * Objectif : éviter une page "footer seul" quand on peut encore afficher
   * des lignes au-dessus, et éviter que Chrome coupe/duplique une page vide.
   */
  const firstPageWithFooterRows = 16;
  const firstPageRowsWithoutFooter = 34;
  const middlePageRows = 34;
  const lastPageRowsWithFooter = 14;

  if (safeLines.length <= firstPageWithFooterRows) {
    return [{ includeHeader: true, includeFooter: true, lines: safeLines }];
  }

  const pages: InvoicePrintPage[] = [];
  let cursor = 0;

  const firstPageLines = safeLines.slice(cursor, cursor + firstPageRowsWithoutFooter);
  pages.push({
    includeHeader: true,
    includeFooter: false,
    lines: firstPageLines,
  });
  cursor += firstPageLines.length;

  let remaining = safeLines.length - cursor;

  while (remaining > middlePageRows + lastPageRowsWithFooter) {
    const pageLines = safeLines.slice(cursor, cursor + middlePageRows);
    pages.push({
      includeHeader: false,
      includeFooter: false,
      lines: pageLines,
    });
    cursor += pageLines.length;
    remaining = safeLines.length - cursor;
  }

  if (remaining > lastPageRowsWithFooter) {
    const linesBeforeFooter = remaining - lastPageRowsWithFooter;
    const pageLines = safeLines.slice(cursor, cursor + linesBeforeFooter);
    pages.push({
      includeHeader: false,
      includeFooter: false,
      lines: pageLines,
    });
    cursor += pageLines.length;
  }

  pages.push({
    includeHeader: false,
    includeFooter: true,
    lines: safeLines.slice(cursor),
  });

  return pages;
}

export type InvoiceFieldErrors = {
  clientType?: string;
  clientName?: string;
  billingAddress?: string;
  billingPostalCode?: string;
  billingCity?: string;
  clientEmail?: string;
  clientSiren?: string;
  number?: string;
  invoiceDate?: string;
  dueDate?: string;
  operationCategory?: string;
  lines?: string;
};

export function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export const VAT_OPTIONS = [0, 5.5, 10, 20] as const;

export const DOCUMENT_KIND_OPTIONS = [
  { key: "invoice", labelKey: "facture_3953b9f5" },
  { key: "deposit", labelKey: "facture_d_acompte_ce9f9da4" },
  { key: "credit_note", labelKey: "avoir_8ee24717" },
] as const;
