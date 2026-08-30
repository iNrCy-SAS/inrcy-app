import { NextResponse } from "next/server";

import {
  bubbleAccessDisabledResponse,
  isAppBubbleEnabledForUser,
} from "@/lib/appBubbleAccessServer";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { asRecord, asString } from "@/lib/tsSafe";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import {
  fetchPinterestUserAccount,
  getPinterestAccessToken,
  getPinterestApiEnvironment,
  getPinterestIntegration,
} from "@/lib/pinterestOAuth";
import { getPinterestDefaultBoardId, getPinterestPublicProfileUrl } from "@/lib/pinterestPreferences";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authErr || !user)
      return NextResponse.json(
        { ok: false, error: "Non authentifié." },
        { status: 401 },
      );
    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

    if (
      !(await isAppBubbleEnabledForUser(supabase, activeUserId, "pinterest"))
    ) {
      return bubbleAccessDisabledResponse("Pinterest");
    }

    const [states, integrationRaw, defaultBoardId, publicProfileUrl] = await Promise.all([
      getChannelConnectionStates(supabase, activeUserId),
      getPinterestIntegration(activeUserId).catch(() => ({})),
      getPinterestDefaultBoardId(activeUserId).catch(() => ""),
      getPinterestPublicProfileUrl(activeUserId).catch(() => ""),
    ]);
    const integration = asRecord(integrationRaw);
    const connected = Boolean(
      states.pinterest.connected && !states.pinterest.requiresUpdate,
    );

    // Par défaut cette route reste volontairement rapide et locale :
    // aucun appel Pinterest externe pour éviter le faux état "déconnecté"
    // pendant plusieurs secondes à l'ouverture du panneau.
    const includeLive = new URL(request.url).searchParams.get("live") === "1";
    let account: Awaited<ReturnType<typeof fetchPinterestUserAccount>> | null =
      null;

    if (includeLive && connected) {
      const accessToken = await getPinterestAccessToken(
        activeUserId,
        request.url,
      ).catch(() => "");
      if (accessToken) {
        account = await fetchPinterestUserAccount(accessToken).catch(
          () => null,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      connected,
      requiresUpdate: Boolean(states.pinterest.requiresUpdate),
      status: connected ? "connected" : states.pinterest.connection_status,
      accountName: account?.displayName || account?.username || null,
      username: account?.username || null,
      profileUrl: account?.profileUrl || publicProfileUrl || null,
      publicProfileUrl: publicProfileUrl || null,
      boards: [],
      defaultBoardId: connected ? defaultBoardId : "",
      apiEnvironment: getPinterestApiEnvironment(),
      scopes: asString(integration.scopes) || "",
      expiresAt: asString(integration.expires_at) || null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Statut Pinterest indisponible." },
      { status: 400 },
    );
  }
}
