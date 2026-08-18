import StatsClient from "./StatsClient";
import ClientHydrationGate from "../_components/ClientHydrationGate";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { ensureSystemManagedInrSearch } from "@/lib/inrSearchProvisioning";
import { buildInrSearchPublicUrl, getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { getTranslations } from "next-intl/server";

type InitialInrSearchState = {
  published: boolean;
  slug: string;
  publicUrl: string;
  pageTitle: string;
};

async function loadInitialInrSearchState(): Promise<InitialInrSearchState> {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return { published: false, slug: "", publicUrl: "", pageTitle: "" };

    const provisioned = await ensureSystemManagedInrSearch(current.supabase, current.scope.activeUserId);
    const slug = String(provisioned.inrSearch.slug || "").trim();
    const status = await getInrSearchPublicStatus(slug);

    return {
      published: status.published,
      slug,
      publicUrl: slug ? buildInrSearchPublicUrl(slug) : "",
      pageTitle: String(provisioned.inrSearch.pageTitle || "").trim(),
    };
  } catch {
    return { published: false, slug: "", publicUrl: "", pageTitle: "" };
  }
}

export default async function Page() {
  const t = await getTranslations("stats");
  const initialInrSearch = await loadInitialInrSearchState();

  return (
    <ClientHydrationGate label={t("chargement_de_vos_statistiques_2def4130")}>
      <StatsClient initialInrSearch={initialInrSearch} />
    </ClientHydrationGate>
  );
}
