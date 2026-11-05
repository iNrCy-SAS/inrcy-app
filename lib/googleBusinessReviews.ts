import "server-only";

import { asRecord, asString } from "@/lib/tsSafe";
import type { GoogleTokenRow } from "@/lib/googleStats";

export type NormalizedGmbReviewReply = {
  comment: string;
  updateTime: string | null;
};

export type NormalizedGmbReview = {
  name: string;
  reviewId: string;
  reviewerName: string;
  reviewerPhotoUrl: string | null;
  starRating: number;
  starRatingLabel: string;
  comment: string;
  originalComment: string | null;
  translatedComment: string | null;
  createTime: string | null;
  updateTime: string | null;
  reply: NormalizedGmbReviewReply | null;
  replyStatus: "answered" | "unanswered";
  raw?: unknown;
};

export type GmbReviewsPayload = {
  connected: boolean;
  configured: boolean;
  accountName: string | null;
  locationName: string | null;
  locationTitle: string | null;
  averageRating: number | null;
  totalReviewCount: number;
  nextPageToken: string | null;
  reviews: NormalizedGmbReview[];
};

export type GmbReviewReplyPayload = {
  comment: string;
  updateTime: string | null;
};

const STAR_RATING_TO_NUMBER: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

const STAR_RATING_TO_LABEL: Record<string, string> = {
  ONE: "1 étoile",
  TWO: "2 étoiles",
  THREE: "3 étoiles",
  FOUR: "4 étoiles",
  FIVE: "5 étoiles",
};

function cleanPathPart(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeAccountName(value: unknown): string | null {
  const raw = cleanPathPart(asString(value) || "");
  if (!raw) return null;

  const match = /(?:^|\/)accounts\/([^/]+)/.exec(raw);
  if (match?.[1]) return `accounts/${match[1]}`;

  if (!raw.includes("/")) return `accounts/${raw}`;
  return null;
}

function normalizeLocationName(value: unknown): string | null {
  const raw = cleanPathPart(asString(value) || "");
  if (!raw) return null;

  const fullMatch = /(?:^|\/)accounts\/([^/]+)\/locations\/([^/]+)/.exec(raw);
  if (fullMatch?.[2]) return `locations/${fullMatch[2]}`;

  const match = /(?:^|\/)locations\/([^/]+)/.exec(raw);
  if (match?.[1]) return `locations/${match[1]}`;

  if (!raw.includes("/")) return `locations/${raw}`;
  return null;
}

export function getGmbReviewTargetFromRow(row: GoogleTokenRow | null | undefined) {
  const meta = asRecord(row?.meta);
  const metaGmb = asRecord(meta.gmb);

  const accountName =
    normalizeAccountName(meta.account) ||
    normalizeAccountName(meta.accountName) ||
    normalizeAccountName(metaGmb.account) ||
    normalizeAccountName(metaGmb.accountName);

  const locationName =
    normalizeLocationName(row?.resource_id) ||
    normalizeLocationName(meta.location) ||
    normalizeLocationName(meta.locationName) ||
    normalizeLocationName(metaGmb.location) ||
    normalizeLocationName(metaGmb.locationName);

  return {
    accountName,
    locationName,
    locationTitle: (asString(row?.resource_label) || asString(meta.locationTitle) || asString(metaGmb.locationTitle) || null) as string | null,
  };
}

export function buildGmbReviewsParent(accountName: string | null, locationName: string | null) {
  const account = normalizeAccountName(accountName);
  const location = normalizeLocationName(locationName);
  if (!account || !location) return null;
  return `${account}/${location}`;
}

export function normalizeGmbReviewName(value: unknown): string | null {
  const raw = cleanPathPart(asString(value) || "");
  if (!raw) return null;

  const match = /(?:^|\/)accounts\/([^/]+)\/locations\/([^/]+)\/reviews\/([^/]+)/.exec(raw);
  if (!match?.[1] || !match?.[2] || !match?.[3]) return null;

  return `accounts/${match[1]}/locations/${match[2]}/reviews/${match[3]}`;
}

export function isGmbReviewNameForParent(reviewName: string | null, accountName: string | null, locationName: string | null) {
  const normalizedReviewName = normalizeGmbReviewName(reviewName);
  const parent = buildGmbReviewsParent(accountName, locationName);
  if (!normalizedReviewName || !parent) return false;
  return normalizedReviewName.startsWith(`${parent}/reviews/`);
}

async function fetchJsonOrThrow(response: Response, fallback: string) {
  const raw = await response.text().catch(() => "");
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const msg = json?.error?.message || json?.error_description || raw || fallback;
    throw new Error(`Google Business Reviews API (${response.status}): ${msg}`);
  }

  return json;
}

function ratingToNumber(value: unknown) {
  const raw = (asString(value) || "").toUpperCase();
  return STAR_RATING_TO_NUMBER[raw] || 0;
}

function ratingToLabel(value: unknown) {
  const raw = (asString(value) || "").toUpperCase();
  return STAR_RATING_TO_LABEL[raw] || "Avis Google";
}

function extractReviewId(name: string) {
  const clean = cleanPathPart(name);
  const match = /(?:^|\/)reviews\/([^/]+)/.exec(clean);
  return match?.[1] || clean.split("/").pop() || clean;
}

function compactReviewText(value: unknown) {
  return (asString(value) || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanGoogleReviewText(value: unknown) {
  return compactReviewText(value)
    .replace(/\(\s*(?:Translated by Google|Traduit par Google|Translation by Google|Traduction Google)\s*\)\s*/gi, "")
    .replace(/\(\s*(?:Original|Texte original)\s*\)\s*/gi, "")
    .trim();
}

function splitGoogleReviewText(value: unknown) {
  const text = compactReviewText(value);
  if (!text) return { original: "", translated: "" };

  const translatedMarker = /\(\s*(?:Translated by Google|Traduit par Google|Translation by Google|Traduction Google)\s*\)/i;
  const originalMarker = /\(\s*(?:Original|Texte original)\s*\)/i;
  const translatedMatch = translatedMarker.exec(text);
  const originalMatch = originalMarker.exec(text);

  if (originalMatch) {
    const original = cleanGoogleReviewText(text.slice(originalMatch.index + originalMatch[0].length));
    const translatedSource = translatedMatch && translatedMatch.index < originalMatch.index
      ? text.slice(translatedMatch.index + translatedMatch[0].length, originalMatch.index)
      : text.slice(0, originalMatch.index);
    const translated = cleanGoogleReviewText(translatedSource);
    return { original, translated };
  }

  return { original: cleanGoogleReviewText(text), translated: "" };
}

export function normalizeGmbReview(rawReview: unknown): NormalizedGmbReview {
  const review = asRecord(rawReview);
  const reviewer = asRecord(review.reviewer);
  const reply = asRecord(review.reviewReply);
  const replyComment = cleanGoogleReviewText(reply.comment);
  const name = asString(review.name) || "";
  const reviewerName = (asString(reviewer.displayName) || "").trim() || "Client Google";
  const commentParts = splitGoogleReviewText(review.comment);
  const comment = commentParts.original || commentParts.translated || cleanGoogleReviewText(review.comment);

  return {
    name,
    reviewId: extractReviewId(name),
    reviewerName,
    reviewerPhotoUrl: asString(reviewer.profilePhotoUrl) || null,
    starRating: ratingToNumber(review.starRating),
    starRatingLabel: ratingToLabel(review.starRating),
    comment,
    originalComment: commentParts.original || null,
    translatedComment: commentParts.translated || null,
    createTime: asString(review.createTime) || null,
    updateTime: asString(review.updateTime) || null,
    reply: replyComment
      ? {
          comment: replyComment,
          updateTime: asString(reply.updateTime) || null,
        }
      : null,
    replyStatus: replyComment ? "answered" : "unanswered",
    raw: rawReview,
  };
}

export async function gmbListReviews(
  accessToken: string,
  accountName: string,
  locationName: string,
  options: { pageSize?: number; pageToken?: string | null; orderBy?: string | null } = {}
): Promise<GmbReviewsPayload> {
  const parent = buildGmbReviewsParent(accountName, locationName);
  if (!parent) {
    throw new Error("Établissement Google Business incomplet.");
  }

  const pageSize = Math.min(Math.max(Number(options.pageSize || 20), 1), 50);
  const url = new URL(`https://mybusiness.googleapis.com/v4/${parent}/reviews`);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("orderBy", options.orderBy || "updateTime desc");
  if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
    },
    cache: "no-store",
  });
  const json = await fetchJsonOrThrow(response, "Impossible de récupérer les avis Google Business pour le moment.");

  const reviews = Array.isArray(json?.reviews) ? json.reviews.map(normalizeGmbReview) : [];
  return {
    connected: true,
    configured: true,
    accountName: normalizeAccountName(accountName),
    locationName: normalizeLocationName(locationName),
    locationTitle: null,
    averageRating: typeof json?.averageRating === "number" ? json.averageRating : Number.isFinite(Number(json?.averageRating)) ? Number(json.averageRating) : null,
    totalReviewCount: Number.isFinite(Number(json?.totalReviewCount)) ? Number(json.totalReviewCount) : reviews.length,
    nextPageToken: asString(json?.nextPageToken) || null,
    reviews,
  };
}

/** Fetch the exact review for a scoped reply preview/read-back, independently of pagination. */
export async function gmbGetReview(accessToken: string, reviewName: string): Promise<NormalizedGmbReview> {
  const name = normalizeGmbReviewName(reviewName);
  if (!name) throw new Error("Avis Google introuvable.");
  const response = await fetch(`https://mybusiness.googleapis.com/v4/${name}`, {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}`, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7" }, cache: "no-store",
  });
  return normalizeGmbReview(await fetchJsonOrThrow(response, "Impossible de relire cet avis Google Business."));
}


export async function gmbReplyToReview(accessToken: string, reviewName: string, comment: string): Promise<GmbReviewReplyPayload> {
  const normalizedReviewName = normalizeGmbReviewName(reviewName);
  const cleanComment = String(comment || "").trim();

  if (!normalizedReviewName) {
    throw new Error("Avis Google invalide.");
  }
  if (!cleanComment) {
    throw new Error("La réponse ne peut pas être vide.");
  }

  const response = await fetch(`https://mybusiness.googleapis.com/v4/${normalizedReviewName}/reply`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comment: cleanComment }),
    cache: "no-store",
  });

  const json = await fetchJsonOrThrow(response, "Impossible de publier la réponse Google Business pour le moment.");

  return {
    comment: (asString(json?.comment) || cleanComment).trim(),
    updateTime: asString(json?.updateTime) || null,
  };
}


export async function gmbDeleteReviewReply(accessToken: string, reviewName: string): Promise<void> {
  const normalizedReviewName = normalizeGmbReviewName(reviewName);

  if (!normalizedReviewName) {
    throw new Error("Avis Google invalide.");
  }

  const response = await fetch(`https://mybusiness.googleapis.com/v4/${normalizedReviewName}/reply`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  await fetchJsonOrThrow(response, "Impossible de supprimer la réponse Google Business pour le moment.");
}
