import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { type AiPreferredEngine } from "@/lib/aiEnginePreference";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { withApi } from "@/lib/observability/withApi";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES } from "@/lib/mediaRules";
import {
  commitAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";
import { aiTranscribeMedia } from "@/lib/aiGatewayTranscription";
import { extractVideoAudioForGateway } from "@/lib/transcriptionMedia";

export const runtime = "nodejs";
export const maxDuration = 120;

type CorrectionResponse = {
  text?: string;
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_TRANSCRIBE_BYTES = 40 * 1024 * 1024;
const MIN_AUDIO_BYTES = 900;
const TEMP_AUDIO_FOLDER = "booster-transcription-audio";
const ALLOWED_AUDIO_PREFIXES = ["audio/"];
const ALLOWED_VIDEO_MIME_TYPES = new Set<string>(
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
);
const FAST_GENERATION_TRANSCRIPTION_BUDGET_MS = 7_000;

function normalizeMime(type: string) {
  return (
    String(type || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || ""
  );
}

function isFileLike(value: FormDataEntryValue | null | undefined): value is File {
  if (!value || typeof value === "string") return false;
  const candidate = value as File;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.arrayBuffer === "function"
  );
}

function videoTranscriptionSkipped(source: string) {
  return NextResponse.json({
    ok: true,
    text: "",
    raw_text: "",
    source,
    skipped: true,
  });
}

function isAllowedAudioFile(file: File) {
  const type = normalizeMime(file.type || "");
  if (!type) return true;
  return ALLOWED_AUDIO_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function isAllowedVideoFile(file: File) {
  const type = normalizeMime(file.type || "");
  const name = String(file.name || "").toLowerCase();
  if (!type && /\.(mp4|mov|webm|m4v)$/i.test(name)) return true;
  return (
    ALLOWED_VIDEO_MIME_TYPES.has(type) || /\.(mp4|mov|webm|m4v)$/i.test(name)
  );
}

function safeStorageUserId(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function isOwnedTemporaryAudioPath(storagePath: string, userId: string) {
  const path = String(storagePath || "").replace(/^\/+/, "");
  const prefix = `${safeStorageUserId(userId)}/${TEMP_AUDIO_FOLDER}/`;
  return Boolean(prefix && path.startsWith(prefix) && !path.includes(".."));
}

async function downloadTemporaryAudio(storagePath: string, userId: string) {
  if (!isOwnedTemporaryAudioPath(storagePath, userId)) return null;
  const { data, error } = await supabaseAdmin.storage
    .from("booster")
    .download(storagePath);
  if (error || !data) return null;
  const fileName = storagePath.split("/").pop() || "video-audio.wav";
  return new File([await data.arrayBuffer()], fileName, {
    type: data.type || "audio/wav",
  });
}

function cleanTranscriptText(value: unknown, maxLength = 2000) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^['\"“”‘’]+|['\"“”‘’]+$/g, "")
    .slice(0, maxLength)
    .trim();
}

async function transcribeMedia(
  file: File,
  options: {
    source: "audio" | "video";
    accountId: string;
    timeoutMs?: number;
    deadlineAt?: number;
    signal?: AbortSignal;
  },
) {
  let gatewayFile = file;
  let mediaType = normalizeMime(file.type || "") || "audio/webm";

  if (options.source === "video") {
    try {
      gatewayFile = await extractVideoAudioForGateway(file);
      mediaType = "audio/mpeg";
    } catch (error) {
      // La transcription vidéo est un bonus. On garde un dernier essai best-effort
      // avec le conteneur original avant que l'appelant ne bascule en mode skipped.
      console.warn("[booster-transcribe] video audio extraction unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
      mediaType = normalizeMime(file.type || "") || "video/mp4";
    }
  }

  const result = await aiTranscribeMedia({
    file: gatewayFile,
    accountId: options.accountId,
    mediaType,
    retries: options.deadlineAt ? 0 : 1,
    timeoutMs: options.timeoutMs ?? 70_000,
    deadlineAt: options.deadlineAt,
    signal: options.signal,
  });

  return cleanTranscriptText(result.text);
}

async function correctTranscript(rawTranscript: string, preferredEngine: AiPreferredEngine, accountId: string) {
  const fallback = cleanTranscriptText(rawTranscript);
  if (!fallback) return "";

  try {
    const result = await aiGenerateJSON<CorrectionResponse>({
      feature: "booster.transcript-cleanup",
      accountId,
      engine: preferredEngine,
      system:
        "Tu corriges une transcription dans sa langue d'origine pour une publication professionnelle. Réponds uniquement en JSON avec la clé text.",
      input: `Corrige uniquement les fautes d'orthographe, la ponctuation, les accords et les majuscules du texte ci-dessous.
Ne traduis pas le texte : conserve sa langue d'origine.
Ne change pas le sens, n'invente rien, ne rajoute aucune information, ne transforme pas en publication complète.
Garde un texte naturel, clair et exploitable comme contexte IA.

Texte transcrit :
${fallback}`,
      maxOutputTokens: 650,
      temperature: 0.1,
    });

    return cleanTranscriptText(result?.text || fallback);
  } catch {
    return fallback;
  }
}

const handler = async (request: Request) => {
  const routeStartedAt = Date.now();
  let quotaReservation: AiCreditReservation | null = null;
  let temporaryAudioStoragePath: string | null = null;
  try {
    const { supabase, authUserId, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const { data: businessPreference } = await supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const generationProfile = buildNormalizedAiGenerationProfile({
      business: (businessPreference || {}) as Record<string, unknown>,
      theme: "booster-transcription",
      style: "transcription",
    });
    const preferredEngine = generationProfile.preferences.engine;
    const isAdmin = await isAdminUserForAi(supabase, authUserId);

    const rateLimit = await enforceRateLimit({
      name: "booster_transcribe",
      identifier: activeUserId,
      limit: 40,
      window: "10 m",
    });
    if (rateLimit) return rateLimit;

    const requestContentType = String(
      request.headers.get("content-type") || "",
    ).toLowerCase();
    const jsonBody = requestContentType.includes("application/json")
      ? await request.json().catch(() => null)
      : null;
    const formData = jsonBody ? null : await request.formData().catch(() => null);
    let audio: FormDataEntryValue | File | null | undefined = formData?.get("audio");
    const video = formData?.get("video");
    const originEntry = formData?.get("origin") ?? (jsonBody as any)?.origin;
    const audioFromVideo =
      typeof originEntry === "string" && originEntry.trim() === "video";
    const modeEntry =
      formData?.get("mode") ??
      (jsonBody as any)?.mode ??
      request.headers.get("x-inrcy-transcription-mode");
    const fastGenerationMode =
      String(modeEntry || "")
        .trim()
        .replace(/_/g, "-") === "generation-fast";
    const fastGenerationDeadlineAt =
      routeStartedAt + FAST_GENERATION_TRANSCRIPTION_BUDGET_MS;
    const storagePathEntry = String(
      (jsonBody as any)?.audioStoragePath || "",
    ).trim();
    if (storagePathEntry) {
      if (!isOwnedTemporaryAudioPath(storagePathEntry, activeUserId)) {
        if (audioFromVideo) {
          return videoTranscriptionSkipped("video_audio_storage_invalid");
        }
        return jsonUserFacingError("Chemin audio temporaire invalide.", {
          status: 400,
          code: "audio_storage_invalid",
        });
      }
      temporaryAudioStoragePath = storagePathEntry;
      audio = await downloadTemporaryAudio(storagePathEntry, activeUserId);
      if (!audio) {
        if (audioFromVideo) {
          return videoTranscriptionSkipped("video_audio_storage_unavailable");
        }
        return jsonUserFacingError("Fichier audio temporaire introuvable.", {
          status: 400,
          code: "audio_storage_missing",
        });
      }
    }
    const textEntry = formData?.get("text") ?? (jsonBody as any)?.text;
    const liveText = cleanTranscriptText(
      typeof textEntry === "string" ? textEntry : "",
    );

    if (liveText) {
      if (!isAdmin) {
        const quota = await reserveAiCredits({
          supabase,
          userId: activeUserId,
          action: "transcription",
          credits: 1,
        });
        if (quota.errorResponse) return quota.errorResponse;
        quotaReservation = quota.reservation;
      }
      const correctedText = await correctTranscript(liveText, preferredEngine, activeUserId);
      if (!correctedText) {
        await rollbackAiCredits(quotaReservation);
        return jsonUserFacingError(
          "Le vocal n’a pas pu être converti en texte.",
          {
            status: 502,
            code: "voice_text_cleanup_empty",
          },
        );
      }

      await commitAiCredits(quotaReservation);
      return NextResponse.json({
        ok: true,
        text: correctedText,
        raw_text: liveText,
        source: "live_text",
      });
    }

    if (isFileLike(video)) {
      // La transcription vidéo n'est qu'un enrichissement IA. Un fichier sans piste
      // audio, trop petit pour l'analyse ou dans un conteneur non reconnu ne doit
      // jamais produire un 400/415 visible ni bloquer la génération YouTube.
      if (video.size < MIN_AUDIO_BYTES) {
        return videoTranscriptionSkipped("video_too_short_skipped");
      }

      if (video.size > MAX_VIDEO_TRANSCRIBE_BYTES) {
        return videoTranscriptionSkipped("video_too_large_skipped");
      }

      if (!isAllowedVideoFile(video)) {
        return videoTranscriptionSkipped("video_unsupported_skipped");
      }

      if (fastGenerationMode) {
        return videoTranscriptionSkipped("video_container_fast_mode_skipped");
      }

      if (!isAdmin) {
        const quota = await reserveAiCredits({
          supabase,
          userId: activeUserId,
          action: "transcription",
          credits: 3,
        });
        if (quota.errorResponse) return quota.errorResponse;
        quotaReservation = quota.reservation;
      }

      // L'analyse audio d'une vidéo est un bonus de contexte pour l'IA, jamais un
      // prérequis de génération. Si la transcription Gateway est momentanément indisponible,
      // on laisse Booster continuer avec la phrase libre + les frames vidéo au lieu de
      // remonter un 502 visible dans la console et de dégrader l'expérience client.
      let transcript = "";
      try {
        transcript = await transcribeMedia(video, {
          source: "video",
          accountId: activeUserId,
          signal: request.signal,
        });
      } catch {
        await rollbackAiCredits(quotaReservation);
        return NextResponse.json({
          ok: true,
          text: "",
          raw_text: "",
          source: "video_audio_unavailable",
          skipped: true,
        });
      }

      if (!transcript) {
        await rollbackAiCredits(quotaReservation);
        return NextResponse.json({
          ok: true,
          text: "",
          raw_text: "",
          source: "video_audio_empty",
          skipped: true,
        });
      }

      const correctedText = await correctTranscript(transcript, preferredEngine, activeUserId);
      if (!correctedText) {
        await commitAiCredits(quotaReservation);
        return NextResponse.json({
          ok: true,
          text: transcript,
          raw_text: transcript,
          source: "video_audio_raw",
          skipped_cleanup: true,
        });
      }

      await commitAiCredits(quotaReservation);
      return NextResponse.json({
        ok: true,
        text: correctedText,
        raw_text: transcript,
        source: "video_audio",
      });
    }

    if (video !== null && video !== undefined) {
      return videoTranscriptionSkipped("video_payload_unavailable_skipped");
    }

    if (!isFileLike(audio)) {
      if (audioFromVideo) {
        return videoTranscriptionSkipped("video_audio_payload_unavailable_skipped");
      }
      return jsonUserFacingError("Fichier audio manquant.", {
        status: 400,
        code: "audio_missing",
      });
    }

    if (audio.size < MIN_AUDIO_BYTES) {
      if (audioFromVideo) {
        return videoTranscriptionSkipped("video_audio_too_short_skipped");
      }
      return jsonUserFacingError("Le vocal est trop court ou vide.", {
        status: 400,
        code: "audio_too_short",
      });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      if (audioFromVideo) {
        return videoTranscriptionSkipped("video_audio_too_large_skipped");
      }
      return jsonUserFacingError(
        "Le vocal est trop lourd. Réessaie avec un message plus court.",
        {
          status: 413,
          code: "audio_too_large",
        },
      );
    }

    if (!isAllowedAudioFile(audio)) {
      if (audioFromVideo) {
        return videoTranscriptionSkipped("video_audio_unsupported_skipped");
      }
      return jsonUserFacingError("Format audio non supporté.", {
        status: 415,
        code: "audio_unsupported",
      });
    }

    if (!isAdmin) {
      const quota = await reserveAiCredits({
        supabase,
        userId: activeUserId,
        action: "transcription",
        credits: audioFromVideo ? 3 : 2,
      });
      if (quota.errorResponse) return quota.errorResponse;
      quotaReservation = quota.reservation;
    }

    let transcript = "";
    try {
      if (
        fastGenerationMode &&
        fastGenerationDeadlineAt - Date.now() <= 750
      ) {
        await rollbackAiCredits(quotaReservation);
        return videoTranscriptionSkipped("video_audio_fast_deadline_skipped");
      }
      transcript = await transcribeMedia(audio, {
        source: "audio",
        accountId: activeUserId,
        ...(fastGenerationMode
          ? {
              timeoutMs: Math.max(
                1_000,
                fastGenerationDeadlineAt - Date.now(),
              ),
              deadlineAt: fastGenerationDeadlineAt,
            }
          : {}),
        signal: request.signal,
      });
    } catch (error) {
      if (!audioFromVideo) throw error;
      await rollbackAiCredits(quotaReservation);
      return videoTranscriptionSkipped("video_audio_client_unavailable");
    }

    if (!transcript) {
      await rollbackAiCredits(quotaReservation);
      if (audioFromVideo) {
        return videoTranscriptionSkipped("video_audio_client_empty");
      }
      return jsonUserFacingError("Aucun texte n’a été détecté dans le vocal.", {
        status: 422,
        code: "empty_transcript",
      });
    }

    if (fastGenerationMode) {
      await commitAiCredits(quotaReservation);
      return NextResponse.json({
        ok: true,
        text: transcript,
        raw_text: transcript,
        source: "video_audio_fast",
        skipped_cleanup: true,
      });
    }

    const correctedText = await correctTranscript(transcript, preferredEngine, activeUserId);
    if (!correctedText) {
      if (audioFromVideo) {
        await commitAiCredits(quotaReservation);
        return NextResponse.json({
          ok: true,
          text: transcript,
          raw_text: transcript,
          source: "video_audio_client_raw",
          skipped_cleanup: true,
        });
      }
      await rollbackAiCredits(quotaReservation);
      return jsonUserFacingError(
        "Le vocal n’a pas pu être converti en texte.",
        {
          status: 502,
          code: "transcription_empty_after_cleanup",
        },
      );
    }

    await commitAiCredits(quotaReservation);
    return NextResponse.json({
      ok: true,
      text: correctedText,
      raw_text: transcript,
      source: audioFromVideo ? "video_audio_client" : "audio",
    });
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    return jsonUserFacingError(error, {
      status: 502,
      fallback: "Le vocal n’a pas pu être transcrit. Merci de réessayer.",
      code: "booster_transcription_failed",
    });
  } finally {
    if (temporaryAudioStoragePath) {
      await supabaseAdmin.storage
        .from("booster")
        .remove([temporaryAudioStoragePath])
        .catch(() => undefined);
    }
  }
};

export const POST = withApi(handler, { route: "/api/booster/transcribe" });
