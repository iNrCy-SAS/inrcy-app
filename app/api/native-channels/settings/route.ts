import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { NATIVE_CHANNEL_KEYS, type NativeChannelKey } from "@/lib/nativeChannelActivation";
import { syncNativeChannelsForAccount } from "@/lib/nativeChannelActivationServer";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
export const dynamic = "force-dynamic";
async function handle(request?: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  try {
    let mutation: { key: NativeChannelKey; enabled: boolean } | undefined;
    if (request) {
      const body = await request.json().catch(() => null);
      if (!body || !NATIVE_CHANNEL_KEYS.includes(body.key) || typeof body.enabled !== "boolean") return NextResponse.json({ ok: false, error: "Activation invalide." }, { status: 400 });
      if (body.accountId !== auth.activeUserId) return NextResponse.json({ ok: false, error: "L’établissement actif a changé. Rechargez les canaux." }, { status: 409 });
      mutation = { key: body.key, enabled: body.enabled };
    }
    return NextResponse.json(await syncNativeChannelsForAccount(auth.activeUserId, mutation), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: getSimpleFrenchErrorMessage(error, "La synchronisation des canaux est momentanément indisponible.") }, { status: 503 });
  }
}
export async function GET() { return handle(); }
export async function POST(request: Request) { return handle(request); }
