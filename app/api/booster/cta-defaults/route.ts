import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { loadBoosterCtaDefaults } from "@/lib/boosterCtaDefaultsServer";

export async function GET() {
  try {
    const { supabase, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;
    return NextResponse.json(
      await loadBoosterCtaDefaults({
        supabase,
        userId: activeUserId,
      }),
    );
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
}
