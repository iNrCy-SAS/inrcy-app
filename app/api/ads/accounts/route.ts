import { NextResponse } from "next/server";
import { adsOAuthProvider } from "@/lib/adsOAuth";
import { listAdsAccounts, listMetaPages, readAdsIntegration, requirePremiumAdsUser } from "@/lib/adsServer";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const provider = adsOAuthProvider(new URL(request.url).searchParams.get("provider"));
  if (!provider) return NextResponse.json({ error: "Canal inconnu." }, { status: 400 });

  try {
    const connection = await readAdsIntegration(user.activeUserId, provider);
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ connected: false, accounts: [], pages: [] });
    }
    const [accounts, pages] = await Promise.all([
      listAdsAccounts(user.activeUserId, provider),
      provider === "meta" ? listMetaPages(user.activeUserId) : Promise.resolve([]),
    ]);
    return NextResponse.json({ connected: true, accounts, pages });
  } catch (error) {
    return NextResponse.json({
      connected: true,
      accounts: [],
      pages: [],
      error: error instanceof Error ? error.message : "Impossible de charger les comptes publicitaires.",
    }, { status: 502 });
  }
}
