export type StoredBoutiqueAmounts = {
  amount_eur: number | null;
  amount_eur_tax_behavior?: string | null;
  amount_ui: number | null;
};

export function boutiqueStoredTaxLabel(taxBehavior: string | null | undefined) {
  return taxBehavior === "exclusive" ? "HT" : taxBehavior === "inclusive" ? "TTC" : "Base non renseignée";
}

export function formatStoredBoutiqueAmounts(row: StoredBoutiqueAmounts) {
  const format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const parts: string[] = [];
  if (row.amount_eur !== null) {
    parts.push(`${format.format(row.amount_eur)} € ${boutiqueStoredTaxLabel(row.amount_eur_tax_behavior)}`);
  }
  if (row.amount_ui !== null) parts.push(`${format.format(row.amount_ui)} UI`);
  return parts.join(" + ") || "—";
}

export function boutiqueOrderTotals(rows: StoredBoutiqueAmounts[]) {
  return rows.reduce((totals, row) => {
    const euros = Number(row.amount_eur ?? 0);
    const units = Number(row.amount_ui ?? 0);
    if (Number.isFinite(euros)) {
      if (row.amount_eur_tax_behavior === "exclusive") totals.eurHt += euros;
      else if (row.amount_eur_tax_behavior === "inclusive") totals.eurTtc += euros;
      else totals.eurUnclassified += euros;
    }
    if (Number.isFinite(units)) totals.ui += units;
    return totals;
  }, { eurHt: 0, eurTtc: 0, eurUnclassified: 0, ui: 0 });
}
