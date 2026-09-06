import {
  hasCompleteAiMediaSpeechEnding,
} from "./aiMediaDialogue.ts";

export type AiMediaNativeDialogueQaStatus =
  | "passed"
  | "rejected"
  | "unavailable";

export type AiMediaNativeDialogueQaIssue =
  | "expected_dialogue_missing"
  | "transcription_unavailable"
  | "spoken_dialogue_missing"
  | "spoken_dialogue_incomplete"
  | "spoken_dialogue_mismatch"
  | "spoken_dialogue_repeated";

export type AiMediaNativeDialogueQaClip = {
  /** Position narrative du plan, indépendamment de l'ordre du tableau. */
  sceneIndex: number;
  buffer: Buffer;
  mediaType?: string;
  durationSeconds: 4 | 6 | 8;
  /** Début logique dans un MP4 cumulatif Omni de 16/24 secondes. */
  sourceStartSeconds?: number;
  expectedLine: string;
};

export type AiMediaNativeDialogueQaMetrics = {
  expectedTokenCount: number;
  detectedTokenCount: number;
  expectedCoverage: number;
  bestWindowSimilarity: number;
  extraTokenCount: number;
  repeatCount: number;
};

export type AiMediaNativeDialogueQaClipResult = {
  sceneIndex: number;
  status: AiMediaNativeDialogueQaStatus;
  issues: AiMediaNativeDialogueQaIssue[];
  metrics: AiMediaNativeDialogueQaMetrics;
};

export type AiMediaNativeDialogueQaResult = {
  version: 1;
  status: AiMediaNativeDialogueQaStatus;
  clips: AiMediaNativeDialogueQaClipResult[];
  elapsedMs: number;
  model?: string;
};

export type AiMediaNativeDialogueTranscript = {
  text: string;
  model?: string;
};

export type AiMediaNativeDialogueTranscriber = (
  clip: AiMediaNativeDialogueQaClip,
  options: { language: string; signal?: AbortSignal },
) => Promise<AiMediaNativeDialogueTranscript>;

function boundedRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

/**
 * Normalisation volontairement indépendante de la ponctuation et des accents :
 * la reconnaissance vocale peut écrire « rendez vous » pour « rendez-vous »
 * sans que la réplique soit différente à l'oreille.
 */
export function tokenizeAiMediaNativeDialogue(value: unknown): string[] {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, " ")
    // Le chinois et le thaï n'utilisent pas toujours d'espaces entre les
    // unités prononcées. Isoler leurs caractères évite de considérer toute
    // une phrase comme un seul token, tout en gardant les mots latins entiers.
    .replace(/([\u0E00-\u0E7F\u3400-\u9FFF])/gu, " $1 ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  return normalized.match(/[\p{L}\p{N}\p{M}]+/gu) || [];
}

function levenshteinDistance(left: readonly string[], right: readonly string[]) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function tokenSimilarity(left: readonly string[], right: readonly string[]) {
  const maximum = Math.max(left.length, right.length);
  if (!maximum) return 1;
  return boundedRatio(1 - levenshteinDistance(left, right) / maximum);
}

function longestCommonSubsequenceLength(
  left: readonly string[],
  right: readonly string[],
) {
  if (!left.length || !right.length) return 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (const leftToken of left) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let index = 1; index <= right.length; index += 1) {
      current[index] = leftToken === right[index - 1]
        ? (previous[index - 1] ?? 0) + 1
        : Math.max(previous[index] ?? 0, current[index - 1] ?? 0);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function bestWindowSimilarity(
  expected: readonly string[],
  detected: readonly string[],
) {
  if (!expected.length || !detected.length) return 0;
  const slack = Math.max(1, Math.ceil(expected.length * 0.25));
  let best = tokenSimilarity(expected, detected);
  for (let size = Math.max(1, expected.length - slack); size <= expected.length + slack; size += 1) {
    if (size > detected.length) continue;
    for (let start = 0; start + size <= detected.length; start += 1) {
      best = Math.max(best, tokenSimilarity(expected, detected.slice(start, start + size)));
    }
  }
  return boundedRatio(best);
}

function contiguousOccurrences(
  source: readonly string[],
  pattern: readonly string[],
) {
  if (!source.length || !pattern.length || pattern.length > source.length) return 0;
  let count = 0;
  for (let index = 0; index + pattern.length <= source.length;) {
    const matches = pattern.every((token, offset) => source[index + offset] === token);
    if (matches) {
      count += 1;
      index += pattern.length;
    } else {
      index += 1;
    }
  }
  return count;
}

/**
 * Repère aussi le défaut observé en production où Veo répète plusieurs fois
 * les 2–4 premiers mots d'une réplique, sans jamais aller jusqu'à sa fin.
 */
function dialogueRepeatCount(
  expected: readonly string[],
  detected: readonly string[],
) {
  if (!expected.length || !detected.length) return 0;
  let maximum = contiguousOccurrences(detected, expected);
  const minimumChunk = Math.min(expected.length, Math.max(3, Math.ceil(expected.length * 0.3)));
  for (let size = expected.length - 1; size >= minimumChunk; size -= 1) {
    for (let expectedStart = 0; expectedStart + size <= expected.length; expectedStart += 1) {
      maximum = Math.max(
        maximum,
        contiguousOccurrences(
          detected,
          expected.slice(expectedStart, expectedStart + size),
        ),
      );
    }
  }
  return maximum;
}

function isExpectedPrefix(
  expected: readonly string[],
  detected: readonly string[],
) {
  if (!expected.length || !detected.length || detected.length >= expected.length) return false;
  const usefulDetected = detected.slice(-Math.min(detected.length, expected.length));
  const comparable = expected.slice(0, usefulDetected.length);
  return tokenSimilarity(comparable, usefulDetected) >= 0.78;
}

/**
 * Évalue un transcript éphémère. Le texte brut n'est jamais inclus dans le
 * résultat : seuls des métriques et des codes de décision quittent la fonction.
 */
export function evaluateAiMediaNativeDialogue(args: {
  sceneIndex: number;
  expectedLine: string;
  transcript: string;
  language?: string;
}): AiMediaNativeDialogueQaClipResult {
  const expected = tokenizeAiMediaNativeDialogue(args.expectedLine);
  const detected = tokenizeAiMediaNativeDialogue(args.transcript);
  const emptyMetrics: AiMediaNativeDialogueQaMetrics = {
    expectedTokenCount: expected.length,
    detectedTokenCount: detected.length,
    expectedCoverage: 0,
    bestWindowSimilarity: 0,
    extraTokenCount: Math.max(0, detected.length - expected.length),
    repeatCount: 0,
  };

  if (!expected.length) {
    return {
      sceneIndex: args.sceneIndex,
      status: "unavailable",
      issues: ["expected_dialogue_missing"],
      metrics: emptyMetrics,
    };
  }
  if (!detected.length) {
    return {
      sceneIndex: args.sceneIndex,
      status: "rejected",
      issues: ["spoken_dialogue_missing"],
      metrics: emptyMetrics,
    };
  }

  const commonTokens = longestCommonSubsequenceLength(expected, detected);
  const expectedCoverage = boundedRatio(commonTokens / expected.length);
  const similarity = bestWindowSimilarity(expected, detected);
  const extraTokenCount = Math.max(0, detected.length - expected.length);
  const repeatCount = dialogueRepeatCount(expected, detected);
  const issues: AiMediaNativeDialogueQaIssue[] = [];
  const language = String(args.language || "fr").trim().toLowerCase() || "fr";

  const incomplete =
    !hasCompleteAiMediaSpeechEnding(args.transcript, language) ||
    (expectedCoverage < 0.96 && isExpectedPrefix(expected, detected));
  if (incomplete) issues.push("spoken_dialogue_incomplete");
  if (repeatCount >= 2) issues.push("spoken_dialogue_repeated");

  // Deux petites variations ASR restent tolérées, mais pas une autre phrase
  // ni une improvisation sensiblement plus longue que la réplique validée.
  const maximumExtras = Math.max(2, Math.ceil(expected.length * 0.35));
  const meaningfullyMatches = expectedCoverage >= 0.8 && similarity >= 0.68;
  if (!meaningfullyMatches || extraTokenCount > maximumExtras) {
    issues.push("spoken_dialogue_mismatch");
  }

  return {
    sceneIndex: args.sceneIndex,
    status: issues.length ? "rejected" : "passed",
    issues: Array.from(new Set(issues)),
    metrics: {
      expectedTokenCount: expected.length,
      detectedTokenCount: detected.length,
      expectedCoverage,
      bestWindowSimilarity: similarity,
      extraTokenCount,
      repeatCount,
    },
  };
}

function unavailableClipResult(
  clip: AiMediaNativeDialogueQaClip,
): AiMediaNativeDialogueQaClipResult {
  return {
    sceneIndex: clip.sceneIndex,
    status: "unavailable",
    issues: ["transcription_unavailable"],
    metrics: {
      expectedTokenCount: tokenizeAiMediaNativeDialogue(clip.expectedLine).length,
      detectedTokenCount: 0,
      expectedCoverage: 0,
      bestWindowSimilarity: 0,
      extraTokenCount: 0,
      repeatCount: 0,
    },
  };
}

/**
 * Orchestre le contrôle clip par clip. Le transcripteur reçoit bien le
 * `sourceStartSeconds` du clip : il peut ainsi extraire 8 s d'un même MP4
 * cumulatif Omni de 16/24 s sans mélanger les répliques.
 */
export async function auditAiMediaNativeDialogueClips(args: {
  clips: AiMediaNativeDialogueQaClip[];
  language?: string;
  transcribe: AiMediaNativeDialogueTranscriber;
  signal?: AbortSignal;
}): Promise<AiMediaNativeDialogueQaResult> {
  const startedAt = Date.now();
  const language = String(args.language || "fr").trim().toLowerCase() || "fr";
  const results = await Promise.all(args.clips.map(async (clip) => {
    try {
      args.signal?.throwIfAborted();
      const transcription = await args.transcribe(clip, {
        language,
        signal: args.signal,
      });
      args.signal?.throwIfAborted();
      return {
        result: evaluateAiMediaNativeDialogue({
          sceneIndex: clip.sceneIndex,
          expectedLine: clip.expectedLine,
          transcript: transcription.text,
          language,
        }),
        model: transcription.model,
      };
    } catch (error) {
      if (args.signal?.aborted) throw error;
      return { result: unavailableClipResult(clip), model: undefined };
    }
  }));
  const clips = results
    .map((entry) => entry.result)
    .sort((left, right) => left.sceneIndex - right.sceneIndex);
  const status: AiMediaNativeDialogueQaStatus = clips.some(
    (clip) => clip.status === "rejected",
  )
    ? "rejected"
    : clips.some((clip) => clip.status === "unavailable") || !clips.length
      ? "unavailable"
      : "passed";
  const models = Array.from(new Set(results.map((entry) => entry.model).filter(Boolean)));
  return {
    version: 1,
    status,
    clips,
    elapsedMs: Date.now() - startedAt,
    ...(models.length ? { model: models.join("+") } : {}),
  };
}
