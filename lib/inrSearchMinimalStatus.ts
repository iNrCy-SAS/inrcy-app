import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getNativeChannelMissingFields } from "@/lib/nativeChannelActivation";

import { getInrSearchPublicationEligibility } from "@/lib/inrSearchEligibility";
import {
  resolveInrSearchMinimalStatus,
  type InrSearchMinimalStatus,
} from "@/lib/inrSearchMinimalStatusPolicy";

export async function getInrSearchMinimalPublicStatus(params: {
  accountId: unknown;
  inrSearch: unknown;
}): Promise<InrSearchMinimalStatus> {
  const config = params.inrSearch && typeof params.inrSearch === "object" ? params.inrSearch as Record<string, unknown> : {};
  if (config.activationVersion === 1 && config.activationRequested === true) {
    const accountId = String(params.accountId || "");
    const [profile, business] = await Promise.all([
      supabaseAdmin.from("profiles").select("company_legal_name,hq_city,hq_zip").eq("user_id", accountId).maybeSingle(),
      supabaseAdmin.from("business_profiles").select("sector").eq("user_id", accountId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (profile.error || business.error || getNativeChannelMissingFields(profile.data, business.data, {}).inr_search.length) {
      return resolveInrSearchMinimalStatus({ ...params, inrSearch: { ...config, publicationReady: false } });
    }
  }
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
