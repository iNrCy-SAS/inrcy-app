type TikTokAccountDisplayInput = {
  currency?: string | null;
  status?: string;
  eligibleToAssociate?: boolean | null;
};

/** Display only: association eligibility is still verified by the Ads server. */
export function tikTokAdsAccountDisplay(account: TikTokAccountDisplayInput): {
  statusLabel: string;
  reason: string;
  help: string;
} {
  const status = (account.status || "").trim().toUpperCase();
  const statusLabel = status === "STATUS_ENABLE" ? "Actif" : status ? "Non actif" : "Statut non confirmé";
  if (account.currency && account.currency !== "EUR") return {
    statusLabel,
    reason: "euros requis",
    help: "Choisissez un compte publicitaire en euros.",
  };
  if (account.eligibleToAssociate !== false) return { statusLabel, reason: "", help: "" };
  if (!status) return {
    statusLabel,
    reason: "statut non confirmé",
    help: "TikTok n’a pas confirmé que ce compte est actif. Vérifiez son statut dans TikTok Ads Manager, puis rechargez vos comptes.",
  };
  if (status !== "STATUS_ENABLE") return {
    statusLabel,
    reason: "compte non actif",
    help: "Ce compte n’est pas encore actif. Vérifiez sa configuration et sa facturation dans TikTok Ads Manager, puis rechargez vos comptes.",
  };
  return {
    statusLabel,
    reason: "association à vérifier",
    help: "L’association de ce compte reste à vérifier. Rechargez vos comptes et vérifiez les autorisations TikTok Ads si nécessaire.",
  };
}
