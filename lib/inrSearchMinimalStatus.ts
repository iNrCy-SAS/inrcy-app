import "server-only";

import { getInrSearchPublicationEligibility } from "@/lib/inrSearchEligibility";
import {
  resolveInrSearchMinimalStatus,
  type InrSearchMinimalStatus,
} from "@/lib/inrSearchMinimalStatusPolicy";

export async function getInrSearchMinimalPublicStatus(params: {
  accountId: unknown;
  inrSearch: unknown;
}): Promise<InrSearchMinimalStatus> {
  const localStatus = resolveInrSearchMinimalStatus({
    ...params,
    eligibility: null,
  });

  // Les états locaux n'ont aucune raison d'interroger l'abonnement.
  if (localStatus.reason !== "data_unavailable") return localStatus;

  const eligibility = await getInrSearchPublicationEligibility(
    localStatus.accountId,
  );
  return resolveInrSearchMinimalStatus({
    ...params,
    eligibility,
  });
}
