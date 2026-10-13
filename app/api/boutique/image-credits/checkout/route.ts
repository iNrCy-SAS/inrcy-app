import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  return NextResponse.json({ code: "IMAGE_CREDITS_LEGACY_PACK_RETIRED", error: "Les recharges sont désormais communes aux images et aux vidéos. Utilisez les packs de crédits médias." }, { status: 410 });
}
