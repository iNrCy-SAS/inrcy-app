import { NextRequest, NextResponse } from "next/server";
import {
  generateSharedBoosterPosts,
  type BoosterAiImage,
} from "@/lib/boosterPublishGeneration";
import {
  AI_ENGINE_OPTIONS,
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import type {
  BoosterChannels,
  BoosterStyle,
  BoosterTheme,
} from "@/lib/boosterPrompt";
import { normalizeAiLanguageCode } from "@/lib/aiGenerationProfile";
import { captureAiGatewayOperationTelemetry } from "@/lib/aiGatewayOperationTelemetry";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_CHANNELS = new Set<BoosterChannels>([
  "inrcy_site",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
]);

const TEST_ENGINES = new Set<AiPreferredEngine>(
  AI_ENGINE_OPTIONS.map((option) => option.value),
);

const MAX_TEST_IMAGE_CHARS = 12_000_000;

type JsonRecord = Record<string, unknown>;

type QaScenario = {
  id?: unknown;
  idea?: unknown;
  channels?: unknown;
  language?: unknown;
  creativity?: unknown;
  profile?: unknown;
  media?: unknown;
  videoContext?: unknown;
  preferences?: unknown;
  business?: unknown;
  testImage?: unknown;
};

function cleanText(value: unknown, max = 4_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function getBearerToken(request: NextRequest) {
  const raw = request.headers.get("authorization") || "";
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
}

function isAuthorized(request: NextRequest) {
  const expected = cleanText(process.env.AI_GATEWAY_LIVE_QA_SECRET, 500);
  if (!expected) return false;
  return getBearerToken(request) === expected;
}

function normalizeChannels(value: unknown) {
  if (!Array.isArray(value)) return [] as BoosterChannels[];
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item, 80) as BoosterChannels)
        .filter((channel) => ALLOWED_CHANNELS.has(channel)),
    ),
  );
}

function normalizeCreativity(value: unknown) {
  const raw = cleanText(value, 40).toLowerCase();
  return raw === "classic" || raw === "creative" ? raw : "balanced";
}

function styleFromCreativity(value: string): BoosterStyle {
  if (value === "creative") return "dynamique";
  if (value === "classic") return "sobre";
  return "equilibre";
}

function themeFromIdea(value: string): BoosterTheme {
  const text = value.toLowerCase();
  if (/conseil|advice|consejo|consiglio|beratung|advies/.test(text)) return "conseil";
  if (/offre|promotion|discount|descuento|sconto/.test(text)) return "promotion";
  if (/actualité|actualite|news|novedad|novita|nieuws/.test(text)) return "actualite";
  return "realisation";
}

function buildProductionProfile(engine: AiPreferredEngine, scenario: QaScenario) {
  const preferences = asRecord(scenario.preferences);
  const business = asRecord(scenario.business);
  const isFull = cleanText(scenario.profile, 40) === "full";
  const language = normalizeAiLanguageCode(scenario.language);
  const creativity = normalizeCreativity(scenario.creativity);

  const profile: JsonRecord = {
    company_legal_name: cleanText(business.company || business.companyName, 120) || (isFull ? "Jardin Horizon" : ""),
    hq_city: cleanText(business.city, 100) || "Arras",
    hq_zip: isFull ? "62000" : "",
    contact_email: isFull ? "contact@example.test" : "",
    phone: isFull ? "+33 3 00 00 00 00" : "",
  };

  const productionBusiness: JsonRecord = {
    sector: cleanText(business.sector, 120) || "maison_services",
    profession: cleanText(business.profession, 120) || "paysagiste",
    business_description: isFull
      ? "Entreprise de paysagisme spécialisée dans l'aménagement extérieur et l'entretien de jardins."
      : "",
    services: Array.isArray(business.services)
      ? business.services
      : isFull
        ? ["création de terrasses", "entretien de jardins", "aménagement extérieur"]
        : [],
    intervention_zones: Array.isArray(business.zones)
      ? business.zones
      : isFull
        ? ["Arras", "Lens", "Douai"]
        : [],
    strengths: Array.isArray(business.strengths)
      ? business.strengths
      : isFull
        ? ["soin des finitions", "proximité", "conseils personnalisés"]
        : [],
    ai_preferred_engine: engine,
    ai_language: language,
    tone: preferences.tone || (isFull ? "warm" : "serious"),
    communication_style: preferences.communicationStyle || (isFull ? "dynamic" : "simple"),
    ai_creativity: creativity,
    ai_length: preferences.length || (isFull ? "detailed" : "medium"),
    emoji_level: preferences.emojiLevel || (creativity === "creative" ? "dynamic" : "light"),
    ai_voice: preferences.voice || "nous",
    address_mode: preferences.addressMode || "vous",
    ai_commercial_level: preferences.commercialLevel || (isFull ? "balanced" : "discreet"),
    ai_main_goal: preferences.mainGoal || (isFull ? "contacts" : "visibility"),
    ai_preferred_angle: preferences.preferredAngle || (isFull ? "quality" : "trust"),
    preferred_cta: preferences.preferredCta || (isFull ? "devis" : "none"),
  };

  return { profile, business: productionBusiness, language, creativity };
}

function normalizeImages(scenario: QaScenario): BoosterAiImage[] {
  if (cleanText(scenario.media, 40) !== "image") return [];
  const dataUrl = cleanText(scenario.testImage, MAX_TEST_IMAGE_CHARS);
  if (!/^data:image\//i.test(dataUrl)) return [];
  return [{ dataUrl, detail: "low" }];
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: JsonRecord;
  try {
    body = asRecord(await request.json());
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const requestedEngine = normalizeAiPreferredEngine(body.engine);
  if (!TEST_ENGINES.has(requestedEngine)) {
    return NextResponse.json({ error: "Moteur QA invalide." }, { status: 400 });
  }

  const scenario = asRecord(body.scenario) as QaScenario;
  const channels = normalizeChannels(scenario.channels);
  const idea = cleanText(scenario.idea, 4_000);
  if (!channels.length || !idea) {
    return NextResponse.json(
      { error: "Scénario QA incomplet : idea et channels sont requis." },
      { status: 400 },
    );
  }

  const normalized = buildProductionProfile(requestedEngine, scenario);
  const imagesForAI = normalizeImages(scenario);
  const mediaType = cleanText(scenario.media, 40) === "video" ? "video" : "images";
  const videoContext = cleanText(scenario.videoContext, 8_000);
  const startedAt = Date.now();
  const accountId = `live-qa:${requestedEngine}:${cleanText(scenario.id, 100) || "scenario"}`;

  try {
    const captured = await captureAiGatewayOperationTelemetry(() =>
      generateSharedBoosterPosts({
        idea,
        theme: themeFromIdea(idea),
        style: styleFromCreativity(normalized.creativity),
        channels,
        profile: normalized.profile,
        business: normalized.business,
        recentPublications: [],
        imagesForAI,
        mediaType,
        mediaContext: videoContext
          ? `CONTEXTE VIDÉO/TRANSCRIPTION FOURNI POUR LE TEST QA :\n${videoContext}`
          : "",
        aiFeature: "booster.publish",
        accountId,
      }),
    );

    if (!captured.ok) {
      const error = captured.error;
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: unknown }).status || 500)
          : 500;
      const retryAfterSeconds =
        error && typeof error === "object" && "retryAfterSeconds" in error
          ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds || 0)
          : 0;

      return NextResponse.json(
        {
          ok: false,
          pipeline: "generateSharedBoosterPosts",
          engine: requestedEngine,
          scenarioId: cleanText(scenario.id, 100),
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          retryAfterSeconds: retryAfterSeconds || undefined,
          telemetry: captured.telemetry,
        },
        {
          status: Number.isFinite(status) && status >= 400 && status < 600 ? status : 500,
          headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
        },
      );
    }

    const { result, telemetry } = captured;
    return NextResponse.json({
      ok: true,
      pipeline: "generateSharedBoosterPosts",
      engine: requestedEngine,
      scenarioId: cleanText(scenario.id, 100),
      durationMs: Date.now() - startedAt,
      recoveredChannels: result.recoveredChannels,
      output: { versions: result.versions },
      telemetry,
      diagnostics: {
        selectedChannels: channels.length,
        media: cleanText(scenario.media, 40) || "text",
        imagesProvidedToProductionPipeline: imagesForAI.length,
        language: normalized.language,
        creativity: normalized.creativity,
      },
    });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status || 500)
        : 500;
    const retryAfterSeconds =
      error && typeof error === "object" && "retryAfterSeconds" in error
        ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds || 0)
        : 0;

    return NextResponse.json(
      {
        ok: false,
        pipeline: "generateSharedBoosterPosts",
        engine: requestedEngine,
        scenarioId: cleanText(scenario.id, 100),
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        retryAfterSeconds: retryAfterSeconds || undefined,
      },
      {
        status: Number.isFinite(status) && status >= 400 && status < 600 ? status : 500,
        headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
      },
    );
  }
}
