import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { resolveWidgetUserIdFromDomain, normalizeWidgetDomain } from "@/lib/widgets/domainRegistry";
import { renderEmbedHtml, type DesignMode, type FontMode, type LayoutMode, type ThemeMode } from "./_lib/render";

export const runtime = "nodejs";

type WidgetTokenPayload = {
  v: 1;
  domain: string;
  source: string;
  iat: number;
  exp: number;
};

function b64urlEncode(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBuffer(s: string) {
  const pad = s.length % 4;
  const base64 = (s + (pad ? "=".repeat(4 - pad) : "")).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function verifyWidgetToken(token: string, secret: string): WidgetTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Le lien d'accès est invalide.");
  const [body, sig] = parts;
  const expected = b64urlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Le lien d'accès est invalide.");

  const payload = JSON.parse(b64urlDecodeToBuffer(body).toString("utf8")) as WidgetTokenPayload;
  if (!payload || payload.v !== 1) throw new Error("Le lien d'accès est invalide.");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("Jeton expiré");
  return payload;
}

function buildFrameAncestors(): string {
  // Public read-only widget: allow embedding from any site builder/editor.
  // The signed token still controls what content can be requested.
  return "frame-ancestors *";
}

function clampLimit(value: string | null) {
  const parsed = parseInt(value || "5", 10) || 5;
  return Math.min(10, Math.max(3, parsed));
}

function clampFont(value: string | null): FontMode {
  const v = (value || "site").trim().toLowerCase();
  return v === "inter" || v === "poppins" || v === "montserrat" || v === "lora" ? v : "site";
}

function clampLayout(value: string | null): LayoutMode {
  const v = (value || "list").trim().toLowerCase();
  return v === "carousel" || v === "grid" || v === "compact" ? v : "list";
}

function clampDesign(value: string | null): DesignMode {
  const v = (value || "contemporary").trim().toLowerCase();
  return v === "essential" || v === "classic" || v === "contemporary" || v === "futuristic" || v === "elegant" ? v : "contemporary";
}

function clampTheme(value: string | null): ThemeMode {
  const v = (value || "nature").trim().toLowerCase();
  return v === "white" || v === "dark" || v === "gray" || v === "nature" || v === "sand" || v === "blue" || v === "terracotta" || v === "anthracite" || v === "custom" ? v : "nature";
}

function clampAccent(value: string | null) {
  const v = (value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(v) ? v : "";
}


async function fetchArticles(domain: string, source: string, limit: number) {
  const userId = await resolveWidgetUserIdFromDomain(domain, source as "inrcy_site" | "site_web");
  if (!userId) return [];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration Supabase incomplète côté serveur.");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("site_articles")
    .select("id, created_at, title, content, images, media_type, video_url, video_path, video_mime, video_size, video_duration_seconds, video_thumbnail_url, media_metadata")
    .eq("user_id", userId)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as Array<Record<string, unknown>>;
}

function htmlResponse(html: string, status = 200, _domain?: string | null) {
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": buildFrameAncestors(),
    },
  });
}

export async function GET(req: Request) {
  const i18nT = await getTranslations("public");
  try {
    const { searchParams } = new URL(req.url);
    const domain = normalizeWidgetDomain(searchParams.get("domain"));
    const source = (searchParams.get("source") || "site_web").trim();
    const title = (searchParams.get("title") || "Actualités").trim();
    const limit = clampLimit(searchParams.get("limit"));
    const layout = clampLayout(searchParams.get("layout"));
    const font = clampFont(searchParams.get("font"));
    const design = searchParams.has("design") ? clampDesign(searchParams.get("design")) : undefined;
    const theme = clampTheme(searchParams.get("theme"));
    const accent = clampAccent(searchParams.get("accent"));
    const frameId = (searchParams.get("frameId") || "inrcy-embed").trim().slice(0, 120);
    const token = searchParams.get("token") || "";

    if (!domain) return htmlResponse(renderEmbedHtml({ title, articles: [], layout, font, design, theme, accent, frameId }), 400, domain);
    if (source !== "inrcy_site" && source !== "site_web") return htmlResponse(renderEmbedHtml({ title, articles: [], layout, font, design, theme, accent, frameId }), 400, domain);
    if (!token) return htmlResponse(renderEmbedHtml({ title, articles: [], layout, font, design, theme, accent, frameId }), 401, domain);

    const signingSecret = process.env.INRCY_WIDGETS_SIGNING_SECRET;
    if (!signingSecret) throw new Error("Configuration du widget incomplète côté serveur.");

    const tok = verifyWidgetToken(token, signingSecret);
    const tokDomain = normalizeWidgetDomain(tok.domain);
    const tokSource = String(tok.source || "").trim();
    if (tokDomain !== domain || tokSource !== source) {
      return htmlResponse(renderEmbedHtml({ title, articles: [], layout, font, design, theme, accent, frameId }), 403, tokDomain || domain);
    }

    // Do not bind public widgets to the parent frame origin.
    // Site builders (Wix, Webflow, Squarespace, Shopify, etc.) often render
    // previews from technical domains that differ from the final customer domain.
    // The signed token + domain/source match above remain the access control.

    const ip = getClientIp(req);
    const rateLimited = await enforceRateLimit({
      name: "embed_actus_public",
      identifier: `${ip}:${domain}:${source}`,
      limit: 180,
      window: "5 m",
    });
    if (rateLimited) {
      return htmlResponse(renderEmbedHtml({ title, articles: [], layout, font, design, theme, accent, frameId }), 429, tokDomain);
    }

    const articles = await fetchArticles(domain, source, limit);
    return htmlResponse(renderEmbedHtml({ title, articles, layout, font, design, theme, accent, frameId }), 200, tokDomain);
  } catch {
    return htmlResponse(renderEmbedHtml({ title: i18nT("actualites_a3baa78e"), articles: [], layout: "list", font: "site", theme: "nature", frameId: "inrcy-embed" }), 500);
  }
}
