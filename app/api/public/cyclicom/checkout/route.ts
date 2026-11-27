import { NextResponse } from "next/server";

import { getCyclicomInstallments, getCyclicomOffer } from "@/lib/cyclicom/offer";
import { createCyclicomCheckout } from "@/lib/cyclicom/stripe";

function checkoutOrigin(req: Request) {
  const requestOrigin = new URL(req.url).origin;
  const origin = req.headers.get("origin");
  const canonical = process.env.VERCEL_ENV === "production"
    ? "https://app.inrcy.com"
    : process.env.CYCLICOM_CHECKOUT_ORIGIN;
  if (!origin || origin !== (canonical || requestOrigin)) return null;
  if (new URL(origin).protocol !== "https:" && process.env.NODE_ENV === "production") return null;
  return origin;
}

export async function POST(req: Request) {
  const origin = checkoutOrigin(req);
  if (!origin) return new Response(null, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(null, { status: 400 });
  }
  const offer = getCyclicomOffer(String(form.get("pack") ?? ""));
  if (!offer) return new Response(null, { status: 404 });

  const page = new URL(`/cyclicom/paiement/${offer.slug}`, origin);
  const unavailable = () => NextResponse.redirect(new URL("?paiement=indisponible", page), 303);
  const invalid = () => NextResponse.redirect(new URL("?paiement=erreur", page), 303);
  if (process.env.CYCLICOM_CHECKOUT_ENABLED !== "true") return unavailable();

  const countValue = form.get("versements");
  const attempt = String(form.get("tentative") ?? "");
  if (typeof countValue !== "string" || !/^[123]$/.test(countValue) ||
      form.get("accord") !== "oui" || !getCyclicomInstallments(offer, Number(countValue))) return invalid();

  try {
    const url = await createCyclicomCheckout({ offer, count: Number(countValue), attempt, origin });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("[cyclicom-checkout] Checkout unavailable", {
      pack: offer.slug,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return unavailable();
  }
}
