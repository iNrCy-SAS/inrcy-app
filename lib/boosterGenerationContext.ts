import "server-only";

import { Redis } from "@upstash/redis";
import { requireEnv } from "@/lib/env";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";
import type { BoosterRecentPublication } from "@/lib/boosterPrompt";
import { normalizeAiMemory } from "@/lib/aiMemory";
import { hasPremiumDashboardAccess, type DashboardEdition } from "@/lib/dashboardEdition";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

type JsonRecord = Record<string, unknown>;
type SupabaseLike = { from: (table: string) => any };

type ProfessionalContext = {
  profile: JsonRecord | null;
  business: JsonRecord | null;
};

type CacheSource = "hit" | "database" | "disabled";

export type BoosterGenerationContext = ProfessionalContext & {
  recentPublications: BoosterRecentPublication[];
  cacheSource: {
    professional: CacheSource;
    publications: CacheSource;
  };
};

export type AiProfessionalGenerationContext = ProfessionalContext & {
  edition: DashboardEdition;
  cacheSource: CacheSource;
};

export type BoosterGenerationContextScope =
  | "all"
  | "professional"
  | "publications";

const CACHE_VERSION = "v2-ai-memory";
const PROFESSIONAL_CACHE_TTL_SECONDS = 24 * 60 * 60;
const PUBLICATIONS_CACHE_TTL_SECONDS = 6 * 60 * 60;

function getRedis(): Redis | null {
  if (shouldBypassUpstashInCurrentEnv()) return null;

  try {
    const url = requireEnv("KV_REST_API_URL");
    const token = requireEnv("KV_REST_API_TOKEN");
    const globalCache = globalThis as typeof globalThis & {
      __inrcy_booster_context_redis?: Redis;
    };
    if (!globalCache.__inrcy_booster_context_redis) {
      globalCache.__inrcy_booster_context_redis = new Redis({ url, token });
    }
    return globalCache.__inrcy_booster_context_redis;
  } catch {
    return null;
  }
}

function professionalCacheKey(userId: string, edition: DashboardEdition) {
  return `inrcy:booster:generation-context:${CACHE_VERSION}:professional:${edition}:${userId}`;
}

function publicationsCacheKey(userId: string) {
  return `inrcy:booster:generation-context:${CACHE_VERSION}:publications:${userId}`;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseCacheValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseProfessionalContext(value: unknown): ProfessionalContext | null {
  const parsed = asRecord(parseCacheValue(value));
  if (!parsed) return null;

  const profile = parsed.profile === null ? null : asRecord(parsed.profile);
  const business = parsed.business === null ? null : asRecord(parsed.business);
  if (parsed.profile !== null && !profile) return null;
  if (parsed.business !== null && !business) return null;

  return { profile, business };
}

function cleanRecentPublicationField(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeRecentPublications(value: unknown): BoosterRecentPublication[] | null {
  const parsed = parseCacheValue(value);
  if (!Array.isArray(parsed)) return null;

  return parsed
    .slice(0, 5)
    .map((row) => {
      const record = asRecord(row) || {};
      return {
        title: cleanRecentPublicationField(record.title, 90),
        content: cleanRecentPublicationField(record.content, 260),
        cta: cleanRecentPublicationField(record.cta, 90),
        idea: cleanRecentPublicationField(record.idea, 140),
        created_at: cleanRecentPublicationField(record.created_at, 40),
      };
    })
    .filter((row) => row.title || row.content || row.idea || row.cta);
}

async function readProfessionalCache(
  redis: Redis,
  userId: string,
  edition: DashboardEdition,
): Promise<ProfessionalContext | null> {
  try {
    const cached = await redis.get(professionalCacheKey(userId, edition));
    return parseProfessionalContext(cached);
  } catch {
    return null;
  }
}

async function readPublicationsCache(
  redis: Redis,
  userId: string,
): Promise<BoosterRecentPublication[] | null> {
  try {
    const cached = await redis.get(publicationsCacheKey(userId));
    return normalizeRecentPublications(cached);
  } catch {
    return null;
  }
}

async function writeCache(
  redis: Redis,
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch {
    // Le cache est une optimisation uniquement. Supabase reste la source de vérité.
  }
}

async function loadProfessionalContextFromDatabase(
  supabase: SupabaseLike,
  userId: string,
  edition: DashboardEdition,
): Promise<{ context: ProfessionalContext; cacheable: boolean }> {
  const [profileResult, businessResult, memoryResult] = await Promise.all([
    Promise.resolve(
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    ).catch(() => ({ data: null, error: true })),
    Promise.resolve(
      supabase
        .from("business_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ).catch(() => ({ data: null, error: true })),
    Promise.resolve(
      supabase
        .from("business_ai_memories")
        .select("memory,completion_score")
        .eq("account_id", userId)
        .maybeSingle(),
    ).catch(() => ({ data: null, error: true })),
  ]);

  const rawBusiness = asRecord(businessResult?.data);
  const rawMemoryRow = asRecord(memoryResult?.data);
  const memory = normalizeAiMemory(rawMemoryRow?.memory, {
    includePremium: hasPremiumDashboardAccess(edition),
  });
  const business = rawBusiness || {};

  return {
    context: {
      profile: asRecord(profileResult?.data),
      business: {
        ...business,
        ai_memory: memory,
        ai_memory_completion_score: Number(rawMemoryRow?.completion_score || 0),
        ai_premium_enabled: hasPremiumDashboardAccess(edition),
        dashboard_edition: edition,
      },
    },
    // Avant application de la migration, la génération reste fonctionnelle et
    // sans mémoire. On évite simplement de mettre ce résultat incomplet en cache.
    cacheable: !profileResult?.error && !businessResult?.error && !memoryResult?.error,
  };
}

async function loadRecentPublicationsFromDatabase(
  supabase: SupabaseLike,
  userId: string,
): Promise<{ publications: BoosterRecentPublication[]; cacheable: boolean }> {
  try {
    const { data, error } = await supabase
      .from("publications")
      .select("title,content,cta,idea,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !Array.isArray(data)) {
      return { publications: [], cacheable: false };
    }

    return {
      publications:
        normalizeRecentPublications(data) || ([] as BoosterRecentPublication[]),
      cacheable: true,
    };
  } catch {
    return { publications: [], cacheable: false };
  }
}

async function getProfessionalContext(args: {
  supabase: SupabaseLike;
  userId: string;
  edition: DashboardEdition;
}): Promise<ProfessionalContext & { source: CacheSource }> {
  const redis = getRedis();
  if (redis) {
    const cached = await readProfessionalCache(redis, args.userId, args.edition);
    if (cached) return { ...cached, source: "hit" };
  }

  const loaded = await loadProfessionalContextFromDatabase(
    args.supabase,
    args.userId,
    args.edition,
  );
  if (redis && loaded.cacheable) {
    await writeCache(
      redis,
      professionalCacheKey(args.userId, args.edition),
      loaded.context,
      PROFESSIONAL_CACHE_TTL_SECONDS,
    );
  }

  return {
    ...loaded.context,
    source: redis ? "database" : "disabled",
  };
}

async function getRecentPublications(args: {
  supabase: SupabaseLike;
  userId: string;
}): Promise<{ publications: BoosterRecentPublication[]; source: CacheSource }> {
  const redis = getRedis();
  if (redis) {
    const cached = await readPublicationsCache(redis, args.userId);
    if (cached) return { publications: cached, source: "hit" };
  }

  const loaded = await loadRecentPublicationsFromDatabase(
    args.supabase,
    args.userId,
  );
  if (redis && loaded.cacheable) {
    await writeCache(
      redis,
      publicationsCacheKey(args.userId),
      loaded.publications,
      PUBLICATIONS_CACHE_TTL_SECONDS,
    );
  }

  return {
    publications: loaded.publications,
    source: redis ? "database" : "disabled",
  };
}

/**
 * Contexte professionnel partagé par les générations multicanales Booster,
 * iNrAgent et média. La Mémoire IA y est filtrée serveur selon l'édition active.
 */
export async function getAiProfessionalGenerationContext(args: {
  supabase: SupabaseLike;
  userId: string;
  edition?: DashboardEdition;
}): Promise<AiProfessionalGenerationContext> {
  const edition = args.edition || await getDashboardEditionForAccountId(args.userId);
  const professional = await getProfessionalContext({ ...args, edition });

  return {
    profile: professional.profile,
    business: professional.business,
    edition,
    cacheSource: professional.source,
  };
}

export async function getBoosterGenerationContext(args: {
  supabase: SupabaseLike;
  userId: string;
  edition?: DashboardEdition;
}): Promise<BoosterGenerationContext> {
  const [professional, publications] = await Promise.all([
    getAiProfessionalGenerationContext(args),
    getRecentPublications(args),
  ]);

  return {
    profile: professional.profile,
    business: professional.business,
    recentPublications: publications.publications,
    cacheSource: {
      professional: professional.cacheSource,
      publications: publications.source,
    },
  };
}

export async function invalidateBoosterGenerationContext(
  userId: string,
  scope: BoosterGenerationContextScope = "all",
): Promise<void> {
  const redis = getRedis();
  if (!redis || !userId) return;

  const keys: string[] = [];
  if (scope === "all" || scope === "professional") {
    keys.push(
      professionalCacheKey(userId, "standard"),
      professionalCacheKey(userId, "premium"),
      professionalCacheKey(userId, "founder"),
    );
  }
  if (scope === "all" || scope === "publications") {
    keys.push(publicationsCacheKey(userId));
  }
  if (!keys.length) return;

  try {
    await redis.del(...keys);
  } catch {
    // Fail-open : la durée de vie de sécurité expirera le cache si l'invalidation échoue.
  }
}
