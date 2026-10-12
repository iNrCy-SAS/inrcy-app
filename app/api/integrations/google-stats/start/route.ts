import { NextResponse } from "next/server";
import { makeOAuthState, safeInternalPath } from "@/lib/security";
import { asRecord } from "@/lib/tsSafe";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { createSupabaseServer } from "@/lib/supabaseServer";

const ALLOWED_SOURCES = ["site_web"] as const;
const ALLOWED_PRODUCTS = ["ga4", "gsc"] as const;

type Source = (typeof ALLOWED_SOURCES)[number];
type Product = (typeof ALLOWED_PRODUCTS)[number];

const REQUIRED_SCOPE_BY_PRODUCT: Record<Product, string> = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
};

function isAllowedSource(v: string): v is Source {
  return (ALLOWED_SOURCES as readonly string[]).includes(v);
}
function isAllowedProduct(v: string): v is Product {
  return (ALLOWED_PRODUCTS as readonly string[]).includes(v);
}



function parseScopes(raw: unknown): Set<string> {
  const value = String(raw ?? "").trim();
  if (!value) return new Set();
  return new Set(value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
}

function hasProductBinding(settings: unknown, product: Product): boolean {
  const scopedRoot = asRecord(asRecord(settings)["site_web"]);

  if (product === "ga4") {
    const ga4 = asRecord(scopedRoot["ga4"]);
    return Boolean(String(ga4["property_id"] ?? "").trim() || String(ga4["measurement_id"] ?? "").trim());
  }

  const gsc = asRecord(scopedRoot["gsc"]);
  return Boolean(String(gsc["property"] ?? "").trim());
}

async function findReusableGoogleStatsConnection(params: {
  userId: string;
  source: Source;
  product: Product;
}): Promise<boolean> {
  const { createSupabaseServer } = await import("@/lib/supabaseServer");
  const supabase = await createSupabaseServer();
  const requiredScope = REQUIRED_SCOPE_BY_PRODUCT[params.product];

  const [integrationRes, proCfgRes] = await Promise.all([
    supabase
      .from("integrations")
      .select("status, scopes")
      .eq("user_id", params.userId)
      .eq("provider", "google")
      .eq("source", params.source)
      .eq("product", params.product)
      .maybeSingle(),
    supabase.from("pro_tools_configs").select("settings").eq("user_id", params.userId).maybeSingle(),
  ]);

  const integration = asRecord(integrationRes.data);
  const isConnected = String(integration["status"] ?? "") === "connected";
  const scopes = parseScopes(integration["scopes"]);
  if (!isConnected || !scopes.has(requiredScope)) return false;

  return hasProductBinding(asRecord(proCfgRes.data)["settings"], params.product);
}

function extractDomainFromUrl(rawUrl: string): { normalizedUrl: string; domain: string } | null {
  try {
    // Accept:
    // - https://example.com
    // - http://example.com
    // - example.com (users often omit protocol)
    const input = /^(https?:\/\/)/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    // Keep a normalized URL (no hash)
    u.hash = "";
    return { normalizedUrl: u.toString(), domain: host };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectFromEnv = process.env.GOOGLE_STATS_REDIRECT_URI;

  const appOrigin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const redirectUri = redirectFromEnv || `${appOrigin}/api/integrations/google-stats/callback`;

  if (!clientId) {
    return NextResponse.json({ error: "Configuration Google incomplète côté serveur." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") || "";
  const product = searchParams.get("product") || "";
  const returnTo = safeInternalPath(searchParams.get("returnTo") || `/dashboard?panel=${encodeURIComponent(source)}`, `/dashboard?panel=${encodeURIComponent(source)}`);
  const returnRedirectUrl = new URL(returnTo, appOrigin);

  if (!isAllowedSource(source)) {
    return NextResponse.json({ error: "La source demandée n'est pas reconnue." }, { status: 400 });
  }
  if (!isAllowedProduct(product)) {
    return NextResponse.json({ error: "Produit invalide." }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }
  const accountId = await resolveActiveInrcyAccountId(supabase, authData.user.id);

  try {
    const canReuseExistingConnection = await findReusableGoogleStatsConnection({ userId: accountId, source, product });
    if (canReuseExistingConnection) {
      returnRedirectUrl.searchParams.set("linked", product);
      returnRedirectUrl.searchParams.set("ok", "1");
      returnRedirectUrl.searchParams.set("skipped", "1");
      return NextResponse.redirect(returnRedirectUrl);
    }
  } catch {
    // If the pre-check fails, fall back to the normal OAuth flow.
  }

  const { data: proConfig } = await supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
  const siteWeb = asRecord(asRecord(asRecord(proConfig).settings).site_web);
  const parsed = extractDomainFromUrl(String(siteWeb.url || "").trim());
  if (!parsed) {
    return NextResponse.json({ error: "Le lien du site est manquant ou invalide. Veuillez l’enregistrer puis réessayer." }, { status: 400 });
  }
  const domain = parsed.domain;
  const siteUrl = parsed.normalizedUrl;

  const { stateB64, cookieValue, cookieName } = makeOAuthState("google_stats", returnTo, { source, product, domain, siteUrl, accountId });

  const requestedScopes = [
    REQUIRED_SCOPE_BY_PRODUCT[product],
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    // Un jeton GA4/GSC reste isolé par produit. Fusionner les autorisations
    // historiques réintroduirait d'anciens scopes Google non demandés ici.
    state: stateB64,
    scope: requestedScopes.join(" "),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
