import { NextResponse } from "next/server";
import { extractInrBadgeUserIdFromSlug } from "@/lib/inrBadge";
import { isQrBadgeSource, recordInrBadgeEvent } from "@/lib/inrBadgeAnalytics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getNativeChannelPublicationEligibility } from "@/lib/inrSearchEligibility";

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = clean(body?.slug, 190);
  const userId = extractInrBadgeUserIdFromSlug(slug);
  if (!userId) return NextResponse.json({ ok: false, error: "Badge introuvable" }, { status: 404 });

  const access = await getNativeChannelPublicationEligibility(userId);
  if (!access.inrbadge.allowed && !access.inr_directory.allowed) {
    return NextResponse.json({ ok: false, error: "Badge introuvable" }, { status: 404 });
  }

  const eventType = clean(body?.eventType, 40);
  const source = clean(body?.source, 80);
  const baseEvent = {
    userId,
    slug,
    actionKey: body?.actionKey,
    targetUrl: body?.targetUrl,
    source,
    referrer: body?.referrer,
    visitorId: body?.visitorId,
    metadata: {
      pathname: clean(body?.pathname, 240),
    },
  };

  await recordInrBadgeEvent(supabaseAdmin, {
    ...baseEvent,
    eventType,
  });

  // Sécurité : un QR scanné doit remonter en scan QR même si le second beacon client
  // est bloqué par le navigateur mobile. La clé journalière évite les doublons.
  if (eventType === "view" && isQrBadgeSource(source)) {
    await recordInrBadgeEvent(supabaseAdmin, {
      ...baseEvent,
      eventType: "qr_scan",
      actionKey: null,
      targetUrl: null,
    });
  }

  return NextResponse.json({ ok: true });
}
