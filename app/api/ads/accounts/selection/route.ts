import { NextResponse } from "next/server";
import { adsOAuthProvider } from "@/lib/adsOAuth";
import {
  adsBadOriginResponse,
  adsConnectionStatus,
  adsRequestOriginAllowed,
  listAdsAccounts,
  listMetaPages,
  readAdsIntegration,
  requirePremiumAdsUser,
} from "@/lib/adsServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord } from "@/lib/tsSafe";

type SelectionTarget = "account" | "identity";

function selectionTarget(value: unknown): SelectionTarget | null {
  return value === "account" || value === "identity" ? value : null;
}

function selectedPageId(meta: unknown): string {
  const pageId = asRecord(meta).selected_page_id;
  return typeof pageId === "string" ? pageId : "";
}

function nextMeta(
  meta: unknown,
  updates: {
    pageId?: string | null;
    pageName?: string | null;
    instagramUserId?: string | null;
    accountSelectionCleared?: boolean;
  },
) {
  const next = { ...asRecord(meta) };
  if (updates.pageId !== undefined) {
    if (updates.pageId) next.selected_page_id = updates.pageId;
    else delete next.selected_page_id;
  }
  if (updates.pageName !== undefined) {
    if (updates.pageName) next.selected_page_name = updates.pageName;
    else delete next.selected_page_name;
  }
  if (updates.instagramUserId !== undefined) {
    if (updates.instagramUserId) next.selected_instagram_user_id = updates.instagramUserId;
    else delete next.selected_instagram_user_id;
  }
  if (updates.accountSelectionCleared !== undefined) {
    if (updates.accountSelectionCleared) next.account_selection_cleared = true;
    else delete next.account_selection_cleared;
  }
  return next;
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const provider = adsOAuthProvider(body?.provider);
  if (!provider) return NextResponse.json({ error: "Canal publicitaire inconnu." }, { status: 400 });

  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : undefined;
  const pageId = typeof body?.pageId === "string" ? body.pageId.trim() : undefined;
  if (accountId === undefined && pageId === undefined) {
    return NextResponse.json({ error: "Choisissez un compte annonceur ou une identité." }, { status: 400 });
  }
  if (provider !== "meta" && pageId !== undefined) {
    return NextResponse.json({ error: "Google Ads n’utilise pas d’identité Facebook ou Instagram." }, { status: 400 });
  }

  try {
    const integration = await readAdsIntegration(user.activeUserId, provider);
    if (!integration || adsConnectionStatus(integration) !== "connected") {
      return NextResponse.json({ error: `Reconnectez ${provider === "meta" ? "Meta Ads" : "Google Ads"} avant de choisir un compte.` }, { status: 409 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let updatedMeta = integration.meta;
    let accountLabel = integration.resource_label || "";
    let savedPageId = selectedPageId(integration.meta);

    if (accountId !== undefined) {
      const accounts = await listAdsAccounts(user.activeUserId, provider);
      const account = accounts.find((candidate) => candidate.id === accountId && candidate.currency === "EUR");
      if (!account) {
        return NextResponse.json({ error: "Ce compte publicitaire EUR n’est plus accessible avec cette connexion." }, { status: 403 });
      }
      update.resource_id = account.id;
      update.resource_label = account.name;
      updatedMeta = nextMeta(updatedMeta, { accountSelectionCleared: false });
      update.meta = updatedMeta;
      accountLabel = account.name;
    }

    if (provider === "meta" && pageId !== undefined) {
      const pages = await listMetaPages(user.activeUserId);
      const page = pages.find((candidate) => candidate.id === pageId);
      if (!page) {
        return NextResponse.json({ error: "Cette identité Facebook n’est plus accessible avec cette connexion." }, { status: 403 });
      }
      updatedMeta = nextMeta(updatedMeta, {
        pageId: page.id,
        pageName: page.name,
        instagramUserId: page.instagramUserId || null,
      });
      update.meta = updatedMeta;
      savedPageId = page.id;
    }

    const { error } = await supabaseAdmin
      .from("integrations")
      .update(update)
      .eq("id", integration.id)
      .eq("user_id", user.activeUserId);
    if (error) throw new Error("Impossible d’enregistrer votre choix publicitaire.");

    return NextResponse.json({
      ok: true,
      selectedAccountId: accountId ?? integration.resource_id ?? "",
      selectedAccountLabel: accountLabel,
      selectedPageId: savedPageId,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible d’enregistrer votre choix publicitaire." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const provider = adsOAuthProvider(body?.provider);
  const target = selectionTarget(body?.target);
  if (!provider || !target) return NextResponse.json({ error: "Demande de déconnexion incomplète." }, { status: 400 });
  if (provider !== "meta" && target === "identity") {
    return NextResponse.json({ error: "Google Ads n’utilise pas d’identité Facebook ou Instagram." }, { status: 400 });
  }

  try {
    const integration = await readAdsIntegration(user.activeUserId, provider);
    if (!integration) return NextResponse.json({ ok: true });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (target === "account") {
      update.resource_id = null;
      update.resource_label = null;
      if (provider === "meta") {
        update.meta = nextMeta(integration.meta, {
          pageId: null,
          pageName: null,
          instagramUserId: null,
          accountSelectionCleared: true,
        });
      } else {
        update.meta = nextMeta(integration.meta, { accountSelectionCleared: true });
      }
    } else {
      update.meta = nextMeta(integration.meta, { pageId: null, pageName: null, instagramUserId: null });
    }

    const { error } = await supabaseAdmin
      .from("integrations")
      .update(update)
      .eq("id", integration.id)
      .eq("user_id", user.activeUserId);
    if (error) throw new Error("Impossible de dissocier ce choix publicitaire.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible de dissocier ce choix publicitaire." }, { status: 502 });
  }
}
