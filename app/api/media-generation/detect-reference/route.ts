import { NextResponse } from "next/server";
import sharp from "sharp";

import { aiGenerateJSON, type AiJsonResponseSchema } from "@/lib/aiGatewayClient";
import { DEFAULT_AI_VISION_FALLBACK_MODEL } from "@/lib/aiEnginePreference";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_BODY_CHARS = 820_000;
const PERSON_REFERENCE_SCHEMA: AiJsonResponseSchema = {
  name: "inrcy_person_reference_detection",
  strict: true,
  schema: {
    type: "object",
    properties: { person_reference: { type: "boolean" } },
    required: ["person_reference"],
    additionalProperties: false,
  },
};

function errorResponse(status: number, code: string) {
  return NextResponse.json({ ok: false, code }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const current = await getCurrentInrcyAccountScope();
  if (!current) return errorResponse(401, "UNAUTHORIZED");

  const rateLimited = await enforceRateLimit({
    name: "ai_media_reference_detection",
    identifier: current.scope.activeUserId,
    limit: 30,
    fallbackLimit: 12,
    window: "10 m",
    failClosed: true,
    code: "ai_media_reference_detection_burst",
  });
  if (rateLimited) return rateLimited;

  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_CHARS) {
    return errorResponse(413, "REFERENCE_IMAGE_TOO_LARGE");
  }
  let image: string;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_CHARS) return errorResponse(413, "REFERENCE_IMAGE_TOO_LARGE");
    image = (JSON.parse(body) as { image?: unknown }).image as string;
  } catch {
    return errorResponse(400, "REFERENCE_IMAGE_INVALID");
  }
  if (typeof image !== "string" || image.length > 800_000 ||
      image.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return errorResponse(400, "REFERENCE_IMAGE_INVALID");
  }

  try {
    const buffer = Buffer.from(image, "base64");
    if (buffer.length > 560_000 || buffer.length < 100 ||
        buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return errorResponse(400, "REFERENCE_IMAGE_INVALID");
    }
    const metadata = await sharp(buffer, { limitInputPixels: 2_000_000 }).metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
      return errorResponse(400, "REFERENCE_IMAGE_INVALID");
    }
    const result = await aiGenerateJSON<{ person_reference?: unknown }>({
      feature: "media.reference-detection",
      accountId: current.scope.activeUserId,
      model: DEFAULT_AI_VISION_FALLBACK_MODEL,
      allowProviderFallback: false,
      responseSchema: PERSON_REFERENCE_SCHEMA,
      system: [
        "Tu classes une photo de référence pour iNrStudio ; ne reconnais ni ne nomme personne.",
        "person_reference=true seulement si une ou plusieurs personnes réelles sont un sujet principal clairement visible.",
        "Retourne false pour une affiche, un flyer, une capture d'écran, un produit, un lieu,",
        "une personne minuscule en arrière-plan ou un visage imprimé sur un objet.",
        "En cas de doute, retourne false. Réponds uniquement selon le schéma JSON.",
      ].join(" "),
      input: "Cette image est-elle une photo dont le sujet principal est une ou plusieurs personnes réelles ?",
      images: [{ dataUrl: `data:image/jpeg;base64,${image}`, detail: "low" }],
      maxOutputTokens: 128,
      retries: 0,
      timeoutMs: 16_000,
    });
    if (typeof result.person_reference !== "boolean") {
      return errorResponse(503, "REFERENCE_DETECTION_UNAVAILABLE");
    }
    return NextResponse.json(
      { ok: true, personReference: result.person_reference },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    // Never log the uploaded image, its name, or the model's raw response.
    console.warn("[ai-media] reference detection unavailable", {
      code: error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "unknown")
        : "unknown",
    });
    return errorResponse(503, "REFERENCE_DETECTION_UNAVAILABLE");
  }
}
