import { fetchWithRetry } from "@/lib/observability/fetch";
import { asRecord, asString } from "@/lib/tsSafe";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";

export type FacebookPageAsset = {
  id: string;
  name: string | null;
  access_token: string | null;
  business_id?: string | null;
  business_name?: string | null;
  source: "me_accounts" | "assigned_pages" | "business_owned_pages" | "business_client_pages" | "page_lookup";
  instagram_business_account?: {
    id: string;
    username: string | null;
  } | null;
};

type GraphListResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

type MetaDiscoveryStage =
  | "me_accounts_enriched"
  | "me_accounts_basic"
  | "assigned_pages"
  | "businesses"
  | "business_owned_pages"
  | "business_client_pages"
  | "page_lookup"
  | "granted_page_token"
  | "granted_page_actor"
  | "granted_page_lookup"
  | "granted_page_identity"
  | "permissions";

export type MetaDiscoveryIssue = {
  stage: MetaDiscoveryStage;
  status: number | null;
  code: number | null;
  subcode: number | null;
  type: string | null;
  fbtrace_id: string | null;
  message: string;
  optional: boolean;
};

export type FacebookPageDiscoveryResult = {
  pages: FacebookPageAsset[];
  diagnostics: {
    primary_request_succeeded: boolean;
    primary_fallback_used: boolean;
    issues: MetaDiscoveryIssue[];
  };
};

export type FacebookPageTokenDiscoveryResult = {
  pages: FacebookPageAsset[];
  diagnostics: {
    token_count: number;
    successful_token_count: number;
    recovered_token_count: number;
    issues: MetaDiscoveryIssue[];
  };
};

export type MetaPermissionInspection = {
  permissions: Record<string, string>;
  issue: MetaDiscoveryIssue | null;
};

class MetaGraphApiError extends Error {
  readonly status: number | null;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  readonly fbtraceId: string | null;

  constructor(input: {
    message: string;
    status?: number | null;
    code?: number | null;
    subcode?: number | null;
    type?: string | null;
    fbtraceId?: string | null;
  }) {
    super(input.message);
    this.name = "MetaGraphApiError";
    this.status = input.status ?? null;
    this.code = input.code ?? null;
    this.subcode = input.subcode ?? null;
    this.type = input.type ?? null;
    this.fbtraceId = input.fbtraceId ?? null;
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sanitizeMetaMessage(value: unknown, fallback = "Erreur Meta inconnue."): string {
  const raw = value instanceof Error ? value.message : String(value || "");
  const withoutTokens = raw
    .replace(/access_token=[^&\s]+/gi, "access_token=[masque]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [masque]")
    .trim();
  return (withoutTokens || fallback).slice(0, 500);
}

function toDiscoveryIssue(error: unknown, stage: MetaDiscoveryStage, optional: boolean): MetaDiscoveryIssue {
  if (error instanceof MetaGraphApiError) {
    return {
      stage,
      status: error.status,
      code: error.code,
      subcode: error.subcode,
      type: error.type,
      fbtrace_id: error.fbtraceId,
      message: sanitizeMetaMessage(error),
      optional,
    };
  }

  return {
    stage,
    status: null,
    code: null,
    subcode: null,
    type: null,
    fbtrace_id: null,
    message: sanitizeMetaMessage(error),
    optional,
  };
}

type GraphFetchOptions = {
  retries?: number;
  timeoutMs?: number;
  deadlineAt?: number;
};

async function fetchGraphJson<T>(url: string, options: GraphFetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, {
    cache: "no-store",
    retries: options.retries ?? 0,
    timeoutMs: options.timeoutMs ?? 8_000,
    deadlineAt: options.deadlineAt,
    retryStatuses: [408, 429, 500, 502, 503, 504],
    route: "meta_business_assets",
  });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const rec = asRecord(data);
    const err = asRecord(rec["error"]);
    throw new MetaGraphApiError({
      message: asString(err["message"]) || `HTTP ${res.status}`,
      status: res.status,
      code: asFiniteNumber(err["code"]),
      subcode: asFiniteNumber(err["error_subcode"]),
      type: asString(err["type"]) || null,
      fbtraceId: asString(err["fbtrace_id"]) || null,
    });
  }

  if (data === null) {
    throw new MetaGraphApiError({
      message: "Meta a renvoyé une réponse illisible.",
      status: res.status,
    });
  }

  return data as T;
}

async function fetchAllGraphPages<T>(
  initialUrl: string,
  maxPages = 10,
  options: GraphFetchOptions = {},
): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | null = initialUrl;
  let count = 0;
  while (nextUrl && count < maxPages) {
    const resp: GraphListResponse<T> = await fetchGraphJson<GraphListResponse<T>>(nextUrl, options);
    all.push(...(resp.data || []));
    nextUrl = resp.paging?.next || null;
    count += 1;
  }
  return all;
}

function normalizeInstagramBusinessAccount(value: unknown): FacebookPageAsset["instagram_business_account"] {
  const rec = asRecord(value);
  const id = asString(rec["id"]);
  if (!id) return null;
  return {
    id,
    username: asString(rec["username"]) || null,
  };
}

function normalizePage(
  raw: unknown,
  source: FacebookPageAsset["source"],
  business?: { id?: string | null; name?: string | null },
): FacebookPageAsset | null {
  const rec = asRecord(raw);
  const id = asString(rec["id"]);
  if (!id) return null;
  return {
    id,
    name: asString(rec["name"]) || null,
    access_token: asString(rec["access_token"]) || null,
    business_id: business?.id || null,
    business_name: business?.name || null,
    source,
    instagram_business_account: normalizeInstagramBusinessAccount(rec["instagram_business_account"]),
  };
}

function mergePageIntoMap(merged: Map<string, FacebookPageAsset>, page: FacebookPageAsset) {
  const prev = merged.get(page.id);
  if (!prev) {
    merged.set(page.id, page);
    return;
  }

  merged.set(page.id, {
    ...prev,
    ...page,
    name: page.name || prev.name,
    access_token: page.access_token || prev.access_token,
    business_id: page.business_id || prev.business_id,
    business_name: page.business_name || prev.business_name,
    instagram_business_account: page.instagram_business_account || prev.instagram_business_account || null,
    source: prev.source === "me_accounts" ? prev.source : page.source,
  });
}

function mergePagesIntoMap(merged: Map<string, FacebookPageAsset>, pages: FacebookPageAsset[]) {
  for (const page of pages) mergePageIntoMap(merged, page);
}

async function enrichPageWithLookup(
  page: FacebookPageAsset,
  userToken: string,
  issues: MetaDiscoveryIssue[],
  deadlineAt: number,
): Promise<FacebookPageAsset> {
  if (page.access_token && page.instagram_business_account?.id) return page;

  const lookupTokens = Array.from(new Set([page.access_token, userToken].filter((value): value is string => !!value)));
  let lastError: unknown = null;

  for (const lookupToken of lookupTokens) {
    try {
      const url = `${buildMetaGraphUrl(encodeURIComponent(page.id))}?${new URLSearchParams({
        fields: "id,name,access_token,instagram_business_account{username,id}",
        access_token: lookupToken,
      }).toString()}`;
      const info = await fetchGraphJson<unknown>(url, { retries: 1, timeoutMs: 5_000, deadlineAt });
      const normalized = normalizePage(info, "page_lookup", {
        id: page.business_id || null,
        name: page.business_name || null,
      });
      if (!normalized) return page;
      return {
        ...page,
        name: normalized.name || page.name,
        access_token: normalized.access_token || page.access_token,
        instagram_business_account: normalized.instagram_business_account || page.instagram_business_account || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) issues.push(toDiscoveryIssue(lastError, "page_lookup", true));
  return page;
}

function nativeMetaId(value: unknown): string | null {
  return typeof value === "string" && /^[1-9]\d{0,31}$/.test(value) ? value : null;
}

/** Recovery diagnostics never retain provider descriptions, URLs, or credentials. */
function grantedPageIssue(error: unknown, stage: MetaDiscoveryStage): MetaDiscoveryIssue {
  const issue = toDiscoveryIssue(error, stage, true);
  return { ...issue, message: "Meta n’a pas confirmé l’accès à la Page autorisée." };
}

/** GET-only, bounded reads. Authorization stays in headers and errors stay fixed. */
async function readGrantedPageGraph(
  path: string, params: URLSearchParams, bearer: string, deadlineAt: number,
): Promise<Record<string, unknown>> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 250) throw new MetaGraphApiError({ message: "Vérification Meta interrompue." });
  const response = await fetch(`${buildMetaGraphUrl(path)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(4_000, remaining)),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = asRecord(asRecord(payload).error);
    const type = asString(error.type);
    const trace = asString(error.fbtrace_id);
    throw new MetaGraphApiError({ message: "Lecture Meta refusée.", status: response.status,
      code: asFiniteNumber(error.code), subcode: asFiniteNumber(error.error_subcode),
      type: type === "OAuthException" || type === "GraphMethodException" ? type : null,
      fbtraceId: trace && /^[A-Za-z0-9_-]{1,128}$/.test(trace) ? trace : null });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MetaGraphApiError({ message: "Réponse Meta invalide.", status: response.status });
  }
  return asRecord(payload);
}

/** Native granular Page IDs are candidates, never a substitute for a real Page token. */
async function recoverGrantedFacebookPages(userToken: string, issues: MetaDiscoveryIssue[]): Promise<FacebookPageAsset[]> {
  const appId = String(process.env.FACEBOOK_APP_ID || "").trim();
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || "").trim();
  if (!nativeMetaId(appId) || !appSecret) return [];
  const deadlineAt = Date.now() + 10_000;
  let stage: MetaDiscoveryStage = "granted_page_token";
  let targets: string[];
  try {
    const inspected = await readGrantedPageGraph("debug_token", new URLSearchParams({ input_token: userToken }),
      `${appId}|${appSecret}`, deadlineAt);
    const data = asRecord(inspected.data);
    const actorId = nativeMetaId(data.user_id);
    if (data.is_valid !== true || data.app_id !== appId || data.type !== "USER" || !actorId
      || !Array.isArray(data.scopes) || !data.scopes.includes("pages_show_list") || !data.scopes.includes("pages_read_engagement")) {
      throw new MetaGraphApiError({ message: "Autorisation de Page non vérifiée." });
    }
    const nowSeconds = Date.now() / 1000;
    for (const expiry of [data.expires_at, data.data_access_expires_at]) {
      if (expiry !== undefined && expiry !== 0 && (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry <= nowSeconds)) {
        throw new MetaGraphApiError({ message: "Autorisation de Page expirée." });
      }
    }
    if (!Array.isArray(data.granular_scopes)) return [];
    const nativeTargets = new Set<string>();
    for (const raw of data.granular_scopes) {
      const entry = asRecord(raw);
      if (entry.scope !== "pages_show_list") continue;
      // Missing targets do not mean all Pages. Only an explicit native list is used.
      if (entry.target_ids === undefined) continue;
      if (!Array.isArray(entry.target_ids)) throw new MetaGraphApiError({ message: "Actifs Meta invalides." });
      for (const target of entry.target_ids) {
        const id = nativeMetaId(target);
        if (!id) throw new MetaGraphApiError({ message: "Actif Meta invalide." });
        nativeTargets.add(id);
        if (nativeTargets.size > 20) throw new MetaGraphApiError({ message: "Trop d’actifs Meta." });
      }
    }
    targets = [...nativeTargets];
    if (!targets.length) return [];
    stage = "granted_page_actor";
    const actor = await readGrantedPageGraph("me", new URLSearchParams({ fields: "id" }), userToken, deadlineAt);
    if (actor.id !== actorId) throw new MetaGraphApiError({ message: "Identité Meta incohérente." });
  } catch (error) {
    issues.push(grantedPageIssue(error, stage));
    return [];
  }

  const recovered: FacebookPageAsset[] = [];
  for (const id of targets) {
    stage = "granted_page_lookup";
    try {
      // Keep this basic: an unavailable nested Instagram field must not hide a Facebook Page.
      const page = await readGrantedPageGraph(id, new URLSearchParams({ fields: "id,name,access_token" }), userToken, deadlineAt);
      const pageToken = typeof page.access_token === "string" && page.access_token.trim() === page.access_token
        && page.access_token.length > 0 ? page.access_token : null;
      if (page.id !== id || !pageToken) throw new MetaGraphApiError({ message: "Page Meta non vérifiée." });
      stage = "granted_page_identity";
      const identity = await readGrantedPageGraph("me", new URLSearchParams({ fields: "id" }), pageToken, deadlineAt);
      if (identity.id !== id) throw new MetaGraphApiError({ message: "Identité de Page incohérente." });
      const normalized = normalizePage(page, "page_lookup");
      if (normalized) recovered.push(normalized);
    } catch (error) {
      issues.push(grantedPageIssue(error, stage));
    }
  }
  return recovered;
}

export async function listAccessibleFacebookPagesDetailed(userToken: string): Promise<FacebookPageDiscoveryResult> {
  const merged = new Map<string, FacebookPageAsset>();
  const issues: MetaDiscoveryIssue[] = [];
  const primaryDeadlineAt = Date.now() + 14_000;
  let primaryRequestSucceeded = false;
  let primaryFallbackUsed = false;

  // Chemin historique : on conserve exactement la requête enrichie actuelle.
  try {
    const url = `${buildMetaGraphUrl("me/accounts")}?${new URLSearchParams({
      fields: "id,name,access_token,instagram_business_account{username,id}",
      access_token: userToken,
      limit: "200",
    }).toString()}`;
    const rows = await fetchAllGraphPages<unknown>(url, 10, { retries: 1, timeoutMs: 6_000, deadlineAt: primaryDeadlineAt });
    primaryRequestSucceeded = true;
    mergePagesIntoMap(
      merged,
      rows.map((row) => normalizePage(row, "me_accounts")).filter((row): row is FacebookPageAsset => !!row),
    );
  } catch (error) {
    issues.push(toDiscoveryIssue(error, "me_accounts_enriched", false));
  }

  // Renfort sans rupture : si Meta refuse le champ Instagram imbriqué ou renvoie vide,
  // on redemande uniquement les Pages puis on enrichit chaque Page séparément.
  if (!primaryRequestSucceeded || merged.size === 0) {
    primaryFallbackUsed = true;
    try {
      const url = `${buildMetaGraphUrl("me/accounts")}?${new URLSearchParams({
        fields: "id,name,access_token",
        access_token: userToken,
        limit: "200",
      }).toString()}`;
      const rows = await fetchAllGraphPages<unknown>(url, 10, { retries: 1, timeoutMs: 6_000, deadlineAt: primaryDeadlineAt });
      primaryRequestSucceeded = true;
      mergePagesIntoMap(
        merged,
        rows.map((row) => normalizePage(row, "me_accounts")).filter((row): row is FacebookPageAsset => !!row),
      );
    } catch (error) {
      issues.push(toDiscoveryIssue(error, "me_accounts_basic", false));
    }
  }

  // Priorité à la voie standard : dès que les Pages principales sont connues,
  // on tente leur enrichissement avant les fallbacks facultatifs.
  const primaryEnriched = await Promise.all(
    Array.from(merged.values()).map((page) =>
      enrichPageWithLookup(page, userToken, issues, Date.now() + 8_000),
    ),
  );
  mergePagesIntoMap(merged, primaryEnriched);

  const optionalDeadlineAt = Date.now() + 8_000;

  // Fallback déjà présent avant le renfort. Il reste entièrement best-effort.
  try {
    const url = `${buildMetaGraphUrl("me/assigned_pages")}?${new URLSearchParams({
      fields: "id,name,instagram_business_account{username,id}",
      access_token: userToken,
      limit: "200",
    }).toString()}`;
    const rows = await fetchAllGraphPages<unknown>(url, 10, { retries: 0, timeoutMs: 5_000, deadlineAt: optionalDeadlineAt });
    mergePagesIntoMap(
      merged,
      rows.map((row) => normalizePage(row, "assigned_pages")).filter((row): row is FacebookPageAsset => !!row),
    );
  } catch (error) {
    issues.push(toDiscoveryIssue(error, "assigned_pages", true));
  }

  // Ces fallbacks Business restent facultatifs. Aucune permission business_management
  // n'est ajoutée ni requise par le chemin standard Instagram.
  try {
    const businessesUrl = `${buildMetaGraphUrl("me/businesses")}?${new URLSearchParams({
      fields: "id,name",
      access_token: userToken,
      limit: "200",
    }).toString()}`;
    const businesses = await fetchAllGraphPages<unknown>(businessesUrl, 10, { retries: 0, timeoutMs: 5_000, deadlineAt: optionalDeadlineAt });

    for (const businessRaw of businesses) {
      const businessRec = asRecord(businessRaw);
      const businessId = asString(businessRec["id"]);
      if (!businessId) continue;
      const business = { id: businessId, name: asString(businessRec["name"]) || null };

      const edges: Array<{
        edge: "owned_pages" | "client_pages";
        source: FacebookPageAsset["source"];
        stage: "business_owned_pages" | "business_client_pages";
      }> = [
        { edge: "owned_pages", source: "business_owned_pages", stage: "business_owned_pages" },
        { edge: "client_pages", source: "business_client_pages", stage: "business_client_pages" },
      ];

      for (const { edge, source, stage } of edges) {
        try {
          const edgeUrl = `${buildMetaGraphUrl(`${encodeURIComponent(businessId)}/${edge}`)}?${new URLSearchParams({
            fields: "id,name,instagram_business_account{username,id}",
            access_token: userToken,
            limit: "200",
          }).toString()}`;
          const pages = await fetchAllGraphPages<unknown>(edgeUrl, 10, { retries: 0, timeoutMs: 5_000, deadlineAt: optionalDeadlineAt });
          mergePagesIntoMap(
            merged,
            pages.map((row) => normalizePage(row, source, business)).filter((row): row is FacebookPageAsset => !!row),
          );
        } catch (error) {
          issues.push(toDiscoveryIssue(error, stage, true));
        }
      }
    }
  } catch (error) {
    issues.push(toDiscoveryIssue(error, "businesses", true));
  }

  if (merged.size === 0) {
    const recovered = await recoverGrantedFacebookPages(userToken, issues);
    if (recovered.length > 0) {
      primaryFallbackUsed = true;
      mergePagesIntoMap(merged, recovered);
    }
  }

  const enriched = await Promise.all(
    Array.from(merged.values()).map((page) =>
      enrichPageWithLookup(page, userToken, issues, Date.now() + 8_000),
    ),
  );

  return {
    pages: enriched.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "fr", { sensitivity: "base" })),
    diagnostics: {
      primary_request_succeeded: primaryRequestSucceeded,
      primary_fallback_used: primaryFallbackUsed,
      issues,
    },
  };
}

export async function listAccessibleFacebookPages(userToken: string): Promise<FacebookPageAsset[]> {
  const result = await listAccessibleFacebookPagesDetailed(userToken);
  return result.pages;
}

export function findAccessibleFacebookPage(pages: FacebookPageAsset[], pageId: string): FacebookPageAsset | null {
  return pages.find((page) => page.id === pageId) || null;
}

export function extractFacebookUserTokens(metaLike: unknown, fallbackTokenEnc?: string | null): string[] {
  const meta = asRecord(metaLike);
  const rawCandidates = [
    asString(meta["standard_user_access_token_enc"]),
    asString(meta["business_user_access_token_enc"]),
    asString(meta["user_access_token_enc"]),
    asString(meta["user_access_token"]),
    asString(fallbackTokenEnc || null),
  ].filter(Boolean) as string[];

  const unique: string[] = [];
  for (const raw of rawCandidates) {
    if (!raw || unique.includes(raw)) continue;
    unique.push(raw);
  }
  return unique;
}

export async function listAccessibleFacebookPagesFromTokensDetailed(
  userTokens: string[],
): Promise<FacebookPageTokenDiscoveryResult> {
  const merged = new Map<string, FacebookPageAsset>();
  const issues: MetaDiscoveryIssue[] = [];
  let successfulTokenCount = 0;
  let recoveredTokenCount = 0;

  for (const token of userTokens) {
    if (!token) continue;
    try {
      const result = await listAccessibleFacebookPagesDetailed(token);
      if (result.diagnostics.primary_request_succeeded) successfulTokenCount += 1;
      if (result.diagnostics.primary_fallback_used && result.pages.length > 0) recoveredTokenCount += 1;
      issues.push(...result.diagnostics.issues);
      mergePagesIntoMap(merged, result.pages);
    } catch (error) {
      issues.push(toDiscoveryIssue(error, "me_accounts_enriched", false));
    }
  }

  return {
    pages: Array.from(merged.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "fr", { sensitivity: "base" })),
    diagnostics: {
      token_count: userTokens.filter(Boolean).length,
      successful_token_count: successfulTokenCount,
      recovered_token_count: recoveredTokenCount,
      issues,
    },
  };
}

export async function listAccessibleFacebookPagesFromTokens(userTokens: string[]): Promise<FacebookPageAsset[]> {
  const result = await listAccessibleFacebookPagesFromTokensDetailed(userTokens);
  return result.pages;
}

export async function inspectFacebookUserTokenPermissions(userToken: string): Promise<MetaPermissionInspection> {
  try {
    const url = `${buildMetaGraphUrl("me/permissions")}?${new URLSearchParams({
      access_token: userToken,
      limit: "200",
    }).toString()}`;
    const rows = await fetchAllGraphPages<unknown>(url, 10, {
      retries: 1,
      timeoutMs: 4_000,
      deadlineAt: Date.now() + 8_000,
    });
    const permissions: Record<string, string> = {};
    for (const row of rows) {
      const rec = asRecord(row);
      const permission = asString(rec["permission"]);
      const status = asString(rec["status"]);
      if (permission && status) permissions[permission] = status;
    }
    return { permissions, issue: null };
  } catch (error) {
    return {
      permissions: {},
      issue: toDiscoveryIssue(error, "permissions", true),
    };
  }
}
