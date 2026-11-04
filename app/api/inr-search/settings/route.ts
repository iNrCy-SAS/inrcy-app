import { isInrDirectoryEnabled } from "@/lib/inrDirectorySettings";
import { POST as updateDirectorySettings } from "@/app/api/inr-directory/settings/route";
import { NextResponse } from "next/server";

import { syncNativeChannelsForAccount } from "@/lib/nativeChannelActivationServer";
import { getInrSearchMinimalPublicStatus } from "@/lib/inrSearchMinimalStatus";
import { ensureSystemManagedInrSearch, revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import { normalizeInrSearchDisplaySettings, normalizeInrSearchSections } from "@/lib/inrSearchDisplaySettings";
import { saveInrSearchPresentationSettings, validateInrSearchPresentationPatch } from "@/lib/inrSearchPresentationServer";
import { requireUser } from "@/lib/requireUser";
import { clearAllToolCaches } from "@/lib/statsCache";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

type DirectoryCacheSync = {
  ok: boolean;
  cacheVersion?: number | null;
  warning?: string;
};

async function syncSystemManagedPage(directoryCache?: DirectoryCacheSync) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const provisioned = await ensureSystemManagedInrSearch(supabase, activeUserId);
    if (provisioned.changed) await clearAllToolCaches(supabase, activeUserId);
    const publicStatus = await getInrSearchMinimalPublicStatus({
      accountId: activeUserId,
      inrSearch: provisioned.inrSearch,
    });
    return NextResponse.json(
      {
        ok: true,
        accountId: activeUserId,
        inrSearch: { ...provisioned.inrSearch,
          display: normalizeInrSearchDisplaySettings(provisioned.inrSearch.display),
          sections: normalizeInrSearchSections(provisioned.inrSearch.sections),
          pageTitleOverride: typeof provisioned.inrSearch.pageTitleOverride === "string" ? provisioned.inrSearch.pageTitleOverride : "",
          pageDescriptionOverride: typeof provisioned.inrSearch.pageDescriptionOverride === "string" ? provisioned.inrSearch.pageDescriptionOverride : "",
        },
        directoryEnabled: isInrDirectoryEnabled(provisioned.root),
        publication: {
          allowed: publicStatus.published,
          reason: publicStatus.reason,
        },
        publicStatus,
        ...(directoryCache ? { directoryCache } : {}),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = getSimpleFrenchErrorMessage(error, "Page iNr'Search indisponible.");
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

type InrSearchAction = "connect" | "disconnect" | "directory" | "presentation";

async function applyAction(request: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return NextResponse.json({ ok: false, error: "La demande est invalide." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const body = rawBody as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action as InrSearchAction : null;
  if (!action) return syncSystemManagedPage();
  if (action === "presentation") {
    if (body.accountId !== activeUserId) return NextResponse.json({ ok: false, error: "L’établissement actif a changé. Rechargez les réglages." }, { status: 409 });
    if (!validateInrSearchPresentationPatch(body)) return NextResponse.json({ ok: false, error: "Les réglages de présentation sont invalides." }, { status: 400 });
    try {
      const saved = await saveInrSearchPresentationSettings(supabase, activeUserId, body);
      revalidateInrSearchPublicRoutes(String(saved.slug || ""), true);
      await clearAllToolCaches(supabase, activeUserId);
      return syncSystemManagedPage();
    } catch (error) {
      return NextResponse.json({ ok: false, error: getSimpleFrenchErrorMessage(error, "Les réglages n’ont pas pu être enregistrés.") }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (action === "directory") return updateDirectorySettings(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({ enabled: body.enabled }) }));

  if (!["connect", "disconnect", "directory"].includes(action)) {
    return NextResponse.json({ ok: false, error: "Action iNr'Search inconnue." }, { status: 400 });
  }

  try {
    if (body.accountId !== undefined && body.accountId !== activeUserId) return NextResponse.json({ ok: false, error: "L’établissement actif a changé." }, { status: 409 });
    await syncNativeChannelsForAccount(activeUserId, { key: "inr_search", enabled: action === "connect" });
    await clearAllToolCaches(supabase, activeUserId);
    return syncSystemManagedPage();
  } catch (error) {
    const message = getSimpleFrenchErrorMessage(error, "Mise à jour de la page iNr'Search impossible.");
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  return syncSystemManagedPage();
}

export async function POST(request: Request) {
  return applyAction(request);
}
