#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  evaluateGeneration,
  computeCrossEngineDiversity,
} from "./lib/ai-live-qa-evaluator.mjs";
import { buildCalibrationRecommendations } from "./lib/ai-calibration-recommendations.mjs";
import { buildFinalCertification } from "./lib/ai-live-certification.mjs";

const GATEWAY_BASE_URL = String(
  process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1",
).replace(/\/+$/, "");
const API_KEY = String(
  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "",
).trim();
const APP_BASE_URL = String(process.env.AI_GATEWAY_LIVE_QA_APP_URL || "")
  .trim()
  .replace(/\/+$/, "");
const APP_QA_SECRET = String(process.env.AI_GATEWAY_LIVE_QA_SECRET || "").trim();
const SOURCE = resolve(process.cwd(), "lib/aiEnginePreference.ts");
const DELAY_MS = Math.max(
  0,
  Math.min(10_000, Number(process.env.AI_GATEWAY_LIVE_QA_DELAY_MS || 500) || 0),
);
const REPORT_PATH = String(process.env.AI_GATEWAY_LIVE_QA_REPORT || "").trim();
const CLI_MODE = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
const MODE = String(CLI_MODE || process.env.AI_GATEWAY_LIVE_QA_MODE || "smoke")
  .trim()
  .toLowerCase();
const CONFIRM = String(process.env.AI_GATEWAY_LIVE_QA_CONFIRM || "").trim();

const TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAADsklEQVR42u3doXJaQRiGYWASg2a4kNRW1WCpbiOPiEmvoIorCCYCXV0sJiqVzYVk0DEIKlrBhJTSA3vO/nueR7YNk1nmnW/TFuhvt9seENPAEYCAAQEDAgYBAwIGBAwIGAQMCBgQMAgYEDAgYEDAIGBAwICAAQGDgPljMpk4BFrR96Z2p6d7+7KeD0e9Xm+1WjkTBBym3tuX9e6vzIcjDSPgMMO7/1umGAGHTFfGCDjYnfmfGWsYAYcZXlOMgMMPrylGwLGH1xQj4PDDK2MEHHt43agRcDnpmmIEHOnObIoRcDnDa4oRcPjhlTECjj28btQIOPzwmmIEHH54TTECLiRdU4yAI92ZZYyAyxleN2oEHH54TTECDj+8ppiOBlxeuqaYrgRcxp1ZxnQu4IKH142awgPuwvCaYgoMuGvDa4opJ+BuDq8pJnzAhlfGhAxYum7URA3YndkUEzJgw2uKiRqw4TXFhAzY8MqYqAEbXjdqQgZseE0xIQOWrikmasDuzKaYkAEbXhkTNeDf9dIWDQu4ibwXi4Xn7EhVVYmzeANHAAIGBAwIGAQMCBgQMCBgKMqFI6CeT5N3DuGAb6ufFhiwwCQzvRo5hFeWT829IMcCQ2ACBgEDAgYEDAIGsuefkTiP99Npx0/gcbm0wICAwRUaMr9AYoFBwIArdOvuv3xM9+A3d9+dMBYYEDAIGBAwUEfav8T6cP/Xzxx8uPGJW5BlwAe63f8zSoZcAj4m3Te/RMbQZsA10pUxZBHwifXuPo6Gg/JywqgvJzxXvSkeDco2yLA3DUMTV+h0pblLu0CSdoFT76QdhlQBN1OXhiHtz8BAsICbHEYjDBYYBNzSJBphsMAgYCBuwG3dZjdTzxRYYBAwkAnvC815eDmhTycEBAyu0JD/BRILDAIG8g+4rXfJuHQ7AwsMAgbCBtz8Ldq724EFhgJd/Jhf/+/XzHrjr5fPzXx/s824xnfILgdY8LFbYOjeFXq2GTczv54hOHSFPqWupBfpN+utqirpcVwNEz546m8eAefSsO2NYvm0dgjxrtBJS1MvHKn/ePf59Ec54w6rF5pb4PNWp15o7mfg/fZqT7F0oc2Aa2csXcgl4FdNHihZt5BpwCqFZvivlCBgQMCAgEHAgIABAQMCBgEDAgYEDAIGBAwIGBAwCBgQMCBgQMAgYEDAgIBBwICAAQEDAgYBAwIGBAwIGAQMCBgQMAgYEDAgYEDAIGBAwICAQcCAgAEBAwIGAQMCBgQMCBhK8gtjqO8mllOXqgAAAABJRU5ErkJggg==";

const ALL_CHANNELS = [
  "inrcy_site",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];
const FIVE_CHANNELS = ["gmb", "facebook", "instagram", "linkedin", "pinterest"];

function parseEngineOptions(source) {
  const regex = /\{\s*value:\s*"([^"]+)"[\s\S]*?shortLabel:\s*"([^"]+)"[\s\S]*?model:\s*"([^"]+)"[\s\S]*?supportsVision:\s*(true|false)[\s\S]*?jsonMode:\s*"([^"]+)"[\s\S]*?\}/g;
  return Array.from(source.matchAll(regex), (match) => ({
    engine: match[1],
    label: match[2],
    model: match[3],
    supportsVision: match[4] === "true",
    jsonMode: match[5],
  }));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function extractText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) =>
      typeof part?.text === "string"
        ? part.text
        : typeof part?.output_text === "string"
          ? part.output_text
          : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseObject(text) {
  const candidates = [
    text,
    ...Array.from(String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (m) => m[1]),
  ];
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(String(text).slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(String(candidate || "").trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new Error("JSON objet illisible");
}

function usageFrom(payload) {
  const usage = payload?.usage || {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      Number(usage.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens,
  };
}

function scenarioPreferences({ language, creativity, full }) {
  return full
    ? {
        language,
        tone: "warm",
        communicationStyle: "dynamic",
        creativity,
        length: "detailed",
        emojiLevel: creativity === "creative" ? "dynamic" : "light",
        voice: "nous",
        addressMode: "vous",
        commercialLevel: "balanced",
        mainGoal: "contacts",
        preferredAngle: "quality",
        preferredCta: "devis",
      }
    : {
        language,
        tone: "serious",
        communicationStyle: "simple",
        creativity,
        length: "medium",
        emojiLevel: "none",
        voice: "nous",
        addressMode: "vous",
        commercialLevel: "discreet",
        mainGoal: "visibility",
        preferredAngle: "trust",
        preferredCta: "none",
      };
}

const MATRIX_SCENARIOS = [
  {
    id: "one-fr-minimal-classic-text",
    channels: ["facebook"],
    language: "fr",
    creativity: "classic",
    profile: "minimal",
    media: "text",
    idea: "Présenter une terrasse de 20 m² réalisée chez Michel à Arras, sans inventer de détail.",
  },
  {
    id: "five-es-full-creative-text",
    channels: FIVE_CHANNELS,
    language: "es",
    creativity: "creative",
    profile: "full",
    media: "text",
    idea: "Presentar la renovación de un jardín familiar en Valencia, con un tono humano y sin inventar precios.",
  },
  {
    id: "all-en-full-balanced-text",
    channels: ALL_CHANNELS,
    language: "en",
    creativity: "balanced",
    profile: "full",
    media: "text",
    idea: "Share a completed outdoor landscaping project in Lille and highlight careful workmanship without inventing facts.",
  },
  {
    id: "all-fr-full-creative-image",
    channels: ALL_CHANNELS,
    language: "fr",
    creativity: "creative",
    profile: "full",
    media: "image",
    idea: "Présenter un aménagement extérieur autour d'une maison et valoriser le soin du travail sans inventer le lieu.",
  },
  {
    id: "five-es-minimal-classic-video",
    channels: FIVE_CHANNELS,
    language: "es",
    creativity: "classic",
    profile: "minimal",
    media: "video",
    idea: "Crear contenidos sobre una intervención de mantenimiento exterior mostrada en un vídeo corto.",
    videoContext:
      "Transcripción: hoy mostramos cómo preparamos la zona antes del mantenimiento y cómo dejamos el espacio limpio al terminar.",
  },
  {
    id: "one-en-full-creative-image",
    channels: ["linkedin"],
    language: "en",
    creativity: "creative",
    profile: "full",
    media: "image",
    idea: "Explain the craftsmanship behind an outdoor improvement project using the attached visual only as factual context.",
  },
];

const FULL_EXTRA_SCENARIOS = [
  {
    id: "all-es-full-creative-text",
    channels: ALL_CHANNELS,
    language: "es",
    creativity: "creative",
    profile: "full",
    media: "text",
    idea: "Presentar un nuevo servicio de mantenimiento exterior para empresas locales, sin inventar tarifas.",
  },
  {
    id: "five-en-minimal-classic-text",
    channels: FIVE_CHANNELS,
    language: "en",
    creativity: "classic",
    profile: "minimal",
    media: "text",
    idea: "Announce seasonal garden maintenance availability without inventing dates or discounts.",
  },
  {
    id: "all-fr-minimal-classic-video",
    channels: ALL_CHANNELS,
    language: "fr",
    creativity: "classic",
    profile: "minimal",
    media: "video",
    idea: "Présenter une intervention d'entretien extérieur filmée sur le terrain.",
    videoContext:
      "Transcription : nous protégeons d'abord la zone, nous réalisons l'entretien puis nous nettoyons avant de partir.",
  },
  {
    id: "five-fr-full-creative-image",
    channels: FIVE_CHANNELS,
    language: "fr",
    creativity: "creative",
    profile: "full",
    media: "image",
    idea: "Créer des contenus autour d'un aménagement de terrasse visible sur l'image, en restant strictement factuel.",
  },
  {
    id: "all-it-full-balanced-text",
    channels: ALL_CHANNELS,
    language: "it",
    creativity: "balanced",
    profile: "full",
    media: "text",
    idea: "Presentare un progetto di sistemazione esterna completato con cura, senza inventare prezzi o dettagli del cliente.",
  },
  {
    id: "five-de-full-classic-text",
    channels: FIVE_CHANNELS,
    language: "de",
    creativity: "classic",
    profile: "full",
    media: "text",
    idea: "Ein abgeschlossenes Gartenprojekt sachlich vorstellen und die sorgfältige Arbeit hervorheben, ohne Fakten zu erfinden.",
  },
  {
    id: "five-nl-minimal-creative-text",
    channels: FIVE_CHANNELS,
    language: "nl",
    creativity: "creative",
    profile: "minimal",
    media: "text",
    idea: "Een afgerond tuinproject menselijk presenteren en het nette werk benadrukken zonder details te verzinnen.",
  },
  {
    id: "all-pt-full-balanced-text",
    channels: ALL_CHANNELS,
    language: "pt",
    creativity: "balanced",
    profile: "full",
    media: "text",
    idea: "Apresentar um projeto exterior concluído com cuidado e destacar a qualidade do trabalho sem inventar informações.",
  },
  {
    id: "all-th-full-balanced-text",
    channels: ALL_CHANNELS,
    language: "th",
    creativity: "balanced",
    profile: "full",
    media: "text",
    idea: "นำเสนอโครงการปรับปรุงพื้นที่ภายนอกที่เสร็จสมบูรณ์อย่างใส่ใจ โดยไม่แต่งข้อมูล ราคา หรือรายละเอียดของลูกค้า",
  },
  {
    id: "all-zh-full-balanced-text",
    channels: ALL_CHANNELS,
    language: "zh",
    creativity: "balanced",
    profile: "full",
    media: "text",
    idea: "介绍一个精心完成的户外改造项目，突出施工质量，不虚构价格、客户信息或其他事实。",
  },
];

function buildScenario(raw) {
  const full = raw.profile === "full";
  return {
    ...raw,
    preferences: scenarioPreferences({
      language: raw.language,
      creativity: raw.creativity,
      full,
    }),
    business: full
      ? {
          company: "Jardin Horizon",
          profession: "paysagiste",
          sector: "maison_services",
          city: "Arras",
          services: ["création de terrasses", "entretien de jardins", "aménagement extérieur"],
          zones: ["Arras", "Lens", "Douai"],
          strengths: ["soin des finitions", "proximité", "conseils personnalisés"],
        }
      : { profession: "paysagiste", sector: "maison_services", city: "Arras" },
  };
}

async function smokeCall(engine) {
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" }, mode: { type: "string" } },
    required: ["ok", "mode"],
    additionalProperties: false,
  };
  const system =
    engine.jsonMode === "prompt-only"
      ? `Tu exécutes un smoke test technique iNrCy. Retourne uniquement un objet JSON valide respectant ${JSON.stringify(schema)}.`
      : "Tu exécutes un smoke test technique iNrCy.";
  const body = {
    model: engine.model,
    max_output_tokens: 180,
    ...(engine.jsonMode === "strict"
      ? {
          text: {
            format: {
              type: "json_schema",
              name: "inrcy_live_smoke",
              strict: true,
              schema,
            },
          },
        }
      : {}),
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      {
        role: "user",
        content: [{ type: "input_text", text: 'Réponds avec {"ok":true,"mode":"text"}.' }],
      },
    ],
  };
  const startedAt = Date.now();
  const response = await fetch(`${GATEWAY_BASE_URL}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 240)}`);
  const payload = JSON.parse(raw);
  const parsed = parseObject(extractText(payload));
  if (parsed.ok !== true) {
    throw new Error(`Réponse inattendue: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return { durationMs: Date.now() - startedAt, usage: usageFrom(payload) };
}

async function runProductionScenario(engine, scenario) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 125_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${APP_BASE_URL}/api/internal/ai-live-qa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APP_QA_SECRET}`,
      },
      body: JSON.stringify({
        engine: engine.engine,
        scenario: {
          ...scenario,
          ...(scenario.media === "image" ? { testImage: TEST_IMAGE } : {}),
        },
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Réponse applicative non JSON (${response.status}): ${raw.slice(0, 300)}`);
    }
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(
        `Pipeline production HTTP ${response.status}: ${String(payload?.error || raw).slice(0, 500)}`,
      );
      error.status = response.status;
      error.retryAfter = response.headers.get("Retry-After") || payload?.retryAfterSeconds || null;
      error.telemetry = payload?.telemetry || null;
      throw error;
    }
    if (payload.pipeline !== "generateSharedBoosterPosts") {
      throw new Error(`Pipeline inattendu: ${String(payload.pipeline || "inconnu")}`);
    }

    const output = payload.output;
    const quality = evaluateGeneration({ output, channels: scenario.channels, scenario });
    const recoveredChannels = Array.isArray(payload.recoveredChannels)
      ? payload.recoveredChannels
      : [];
    const telemetry = payload?.telemetry && typeof payload.telemetry === "object"
      ? payload.telemetry
      : null;
    const usage = telemetry
      ? {
          inputTokens: Number(telemetry.inputTokens || 0),
          outputTokens: Number(telemetry.outputTokens || 0),
          totalTokens: Number(telemetry.totalTokens || 0),
        }
      : null;
    const reservedOutputTokens = Number(telemetry?.reservedOutputTokens || 0);
    const outputTokenUtilization =
      telemetry && reservedOutputTokens > 0
        ? Number(telemetry.outputTokens || 0) / reservedOutputTokens
        : null;

    return {
      success: quality.invalidChannels.length === 0,
      engine: engine.engine,
      model: engine.model,
      scenarioId: scenario.id,
      scenario: {
        language: scenario.language,
        creativity: scenario.creativity,
        profile: scenario.profile,
        media: scenario.media,
        channels: scenario.channels,
      },
      durationMs: Number(payload.durationMs || Date.now() - startedAt),
      repairUsed: recoveredChannels.length > 0,
      recoveredChannels,
      visionPrepassUsed: scenario.media === "image" && !engine.supportsVision,
      productionPipeline: payload.pipeline,
      diagnostics: payload.diagnostics || {},
      quality,
      telemetry,
      usage,
      outputTokenUtilization,
      costMicroUsd: telemetry ? Number(telemetry.costMicroUsd || 0) : null,
      costUsd: telemetry ? Number(telemetry.costMicroUsd || 0) / 1_000_000 : null,
      aiCallCount: telemetry ? Number(telemetry.callCount || 0) : null,
      maxHttpAttempts: telemetry ? Number(telemetry.maxHttpAttempts || 0) : null,
      output,
    };
  } finally {
    clearTimeout(timer);
  }
}

function reportFilePath() {
  if (REPORT_PATH) return resolve(process.cwd(), REPORT_PATH);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(process.cwd(), `artifacts/ai-gateway-live-qa-${stamp}.json`);
}

async function main() {
  if (!["smoke", "matrix", "full", "certify"].includes(MODE)) {
    throw new Error(`Mode inconnu: ${MODE}`);
  }
  if (MODE === "smoke" && !API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY ou VERCEL_OIDC_TOKEN manquant. Aucun appel live n'a été lancé.");
  }
  if (MODE !== "smoke" && (!APP_BASE_URL || !APP_QA_SECRET)) {
    throw new Error(
      "Les modes matrix/full doivent tester le vrai pipeline. Définis AI_GATEWAY_LIVE_QA_APP_URL et AI_GATEWAY_LIVE_QA_SECRET.",
    );
  }
  if (MODE === "matrix" && CONFIRM !== "RUN_MATRIX") {
    throw new Error(
      "La matrice live peut consommer des tokens. Définis AI_GATEWAY_LIVE_QA_CONFIRM=RUN_MATRIX.",
    );
  }
  if (MODE === "full" && CONFIRM !== "RUN_FULL_MATRIX") {
    throw new Error(
      "La matrice complète peut consommer beaucoup de tokens. Définis AI_GATEWAY_LIVE_QA_CONFIRM=RUN_FULL_MATRIX.",
    );
  }
  if (MODE === "certify" && CONFIRM !== "RUN_CERTIFICATION") {
    throw new Error(
      "La certification finale lance la matrice complète sur les 8 moteurs. Définis AI_GATEWAY_LIVE_QA_CONFIRM=RUN_CERTIFICATION.",
    );
  }

  const source = await readFile(SOURCE, "utf8");
  const engines = parseEngineOptions(source);
  if (engines.length !== 8) throw new Error(`8 moteurs attendus, ${engines.length} détectés.`);

  console.log(`[AI Gateway live QA] mode=${MODE} — ${engines.length} moteurs`);
  if (MODE === "smoke") {
    const failures = [];
    for (const engine of engines) {
      try {
        const result = await smokeCall(engine);
        console.log(`  ✓ ${engine.label} (${result.durationMs} ms)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${engine.label}: ${message}`);
        console.error(`  ✗ ${engine.label}: ${message}`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
    if (failures.length) {
      console.error(`\n[AI Gateway live QA] ECHEC ${failures.length}/${engines.length}`);
      process.exitCode = 1;
    } else {
      console.log("\n[AI Gateway live QA] OK — 8 moteurs joignables et JSON lisible.");
    }
    return;
  }

  const scenarios = (
    MODE === "full" || MODE === "certify"
      ? [...MATRIX_SCENARIOS, ...FULL_EXTRA_SCENARIOS]
      : MATRIX_SCENARIOS
  ).map(buildScenario);
  const results = [];

  for (const engine of engines) {
    console.log(`\n[${engine.label}] ${scenarios.length} scénarios via pipeline production`);
    for (const scenario of scenarios) {
      try {
        const result = await runProductionScenario(engine, scenario);
        results.push(result);
        console.log(
          `  ${result.success ? "✓" : "△"} ${scenario.id} — score ${(result.quality.totalScore * 100).toFixed(0)}% — ${result.durationMs} ms — repair=${result.repairUsed ? "oui" : "non"}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          success: false,
          engine: engine.engine,
          model: engine.model,
          scenarioId: scenario.id,
          scenario: {
            language: scenario.language,
            creativity: scenario.creativity,
            profile: scenario.profile,
            media: scenario.media,
            channels: scenario.channels,
          },
          durationMs: 0,
          repairUsed: false,
          productionPipeline: "generateSharedBoosterPosts",
          error: message,
          status: error?.status || null,
          retryAfter: error?.retryAfter || null,
          telemetry: error?.telemetry || null,
          usage: error?.telemetry
            ? {
                inputTokens: Number(error.telemetry.inputTokens || 0),
                outputTokens: Number(error.telemetry.outputTokens || 0),
                totalTokens: Number(error.telemetry.totalTokens || 0),
              }
            : null,
          costMicroUsd: error?.telemetry ? Number(error.telemetry.costMicroUsd || 0) : null,
        });
        console.error(`  ✗ ${scenario.id}: ${message}`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }

  const crossEngineDiversity = computeCrossEngineDiversity(results);
  const reportId = `inrcy-live-${Date.now().toString(36)}`;
  const report = {
    version: 4,
    reportId,
    generatedAt: new Date().toISOString(),
    mode: MODE,
    pipeline: "generateSharedBoosterPosts",
    appBaseUrl: APP_BASE_URL,
    engines: engines.map(({ engine, label, model, supportsVision, jsonMode }) => ({
      engine,
      label,
      model,
      supportsVision,
      jsonMode,
    })),
    scenarioCount: scenarios.length,
    languagesCovered: Array.from(new Set(scenarios.map((scenario) => scenario.language))),
    resultCount: results.length,
    crossEngineDiversity,
    results,
  };
  const certification = buildFinalCertification(report, {
    minConfiguredPricingCoverage: MODE === "certify" ? 1 : 0,
  });
  report.certification = certification;
  const calibration = buildCalibrationRecommendations(report);
  const path = reportFilePath();
  const calibrationPath = path.replace(/\.json$/i, ".calibration.json");
  const certificationPath = path.replace(/\.json$/i, ".certification.json");
  await mkdir(dirname(path), { recursive: true });
  await Promise.all([
    writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(calibrationPath, `${JSON.stringify(calibration, null, 2)}\n`, "utf8"),
    writeFile(certificationPath, `${JSON.stringify(certification, null, 2)}\n`, "utf8"),
  ]);

  const failed = results.filter((row) => !row.success).length;
  const repairRate = results.length
    ? results.filter((row) => row.repairUsed).length / results.length
    : 0;
  const rowsWithQuality = results.filter((row) => row.quality);
  const avgQuality = rowsWithQuality.length
    ? rowsWithQuality.reduce((sum, row) => sum + row.quality.totalScore, 0) /
      rowsWithQuality.length
    : 0;

  console.log(
    `\n[AI Gateway live QA] résultats=${results.length}, échecs=${failed}, qualité moyenne=${(avgQuality * 100).toFixed(1)}%, repair rate=${(repairRate * 100).toFixed(1)}%`,
  );
  console.log(`[AI Gateway live QA] pipeline testé: generateSharedBoosterPosts`);
  console.log(`[AI Gateway live QA] rapport: ${path}`);
  console.log(`[AI Gateway live QA] calibration recommandée: ${calibrationPath}`);
  console.log(`[AI Gateway live QA] certification: ${certificationPath}`);
  console.log(
    `[AI Gateway live QA] coût mesuré/estimé: $${certification.metrics.totalCostUsd.toFixed(6)} — tokens=${certification.metrics.totalTokens} — appels moyens=${certification.metrics.averageCallCount.toFixed(2)} — p95=${certification.metrics.p95DurationMs} ms`,
  );
  console.log(
    `[AI Gateway live QA] statut certification: ${certification.status.toUpperCase()} — échecs critiques=${certification.failures.length} — warnings=${certification.warnings.length}`,
  );
  console.log(
    `[AI Gateway live QA] runtime: AI_ENGINE_CALIBRATION_JSON='${JSON.stringify(calibration.calibration)}'`,
  );

  if (MODE === "certify") {
    if (!certification.certified) process.exitCode = 1;
  } else if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[AI Gateway live QA] ERREUR",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
