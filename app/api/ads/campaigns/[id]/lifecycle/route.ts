import { NextResponse } from "next/server";
import {
  adsBadOriginResponse,
  adsRequestOriginAllowed,
  listAdsAccounts,
  readAdsIntegration,
  requirePremiumAdsUser,
} from "@/lib/adsServer";
import {
  canDiscardInterruptedInitialPublish,
  canManageRemoteAdsCampaign,
  hasCompleteInitialPublishResources,
  hasLocalRecoveryDiscardConfirmation,
  hasProviderCampaignIdentifier,
  hasRemoteDeleteConfirmation,
  parseAdsCampaignLifecycleRequest,
  type AdsCampaignLifecycleChanges,
  type AdsCampaignLifecycleRequest,
} from "@/lib/adsCampaignLifecycle";
import {
  createGoogleAdsRemoteCampaignAdapter,
  GoogleAdsRemoteCampaignError,
} from "@/lib/adsGoogleRemoteCampaign";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";
import {
  deleteMetaAdsCampaign,
  MetaAdsLifecycleError,
  readMetaAdsCampaignState,
  setMetaAdsCampaignPaused,
  updateMetaAdsCampaign,
} from "@/lib/adsMetaLifecycle";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ADS_CAMPAIGN_ID_PATTERN } from "../trackingPolicy";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ id: string }> };
type StableRemoteCampaignStatus = "active" | "demo_paused" | "needs_review";
type RemoteLifecycleOperation = "update" | "pause" | "reconcile" | "delete";
type LifecycleClaimOperation = RemoteLifecycleOperation | "initial_publish";
type InitialPublishMode = "demo_paused" | "live";
type LifecycleClaimRequest = { action: LifecycleClaimOperation; changes: AdsCampaignLifecycleChanges; mode?: InitialPublishMode | null };

type LifecycleRecovery = {
  operation: LifecycleClaimOperation;
  previousStatus: StableRemoteCampaignStatus | null;
  changes: AdsCampaignLifecycleChanges | null;
  mode: InitialPublishMode | null;
};

type RemoteActionResult = {
  providerResources: Record<string, unknown>;
  status: "active" | "demo_paused";
  reconciledChanges?: AdsCampaignLifecycleChanges;
};

type RemoteCampaignRow = {
  id: string;
  provider: "google" | "meta";
  ad_account_id: string;
  name: string;
  daily_budget_cents: number;
  end_date: string;
  status: StableRemoteCampaignStatus;
  draft: Record<string, unknown>;
  provider_resources: Record<string, unknown>;
  published_at: string | null;
  updated_at: string;
  last_error: string | null;
};

class AdsLifecyclePersistenceError extends Error {
  readonly remoteChanged = true;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withoutLifecycleMetadata(value: unknown): Record<string, unknown> {
  const resources = { ...record(value) };
  delete resources.inrcyLifecycleClaim;
  delete resources.inrcyLifecycleRecovery;
  return resources;
}

function normalizedRecoveryChanges(value: unknown): AdsCampaignLifecycleChanges | null {
  const changes = record(value);
  const normalized: AdsCampaignLifecycleChanges = {};
  if (Object.hasOwn(changes, "name")) {
    const name = typeof changes.name === "string" ? changes.name.trim() : "";
    if (name.length < 3 || name.length > 100) return null;
    normalized.name = name;
  }
  if (Object.hasOwn(changes, "dailyBudgetCents")) {
    const dailyBudgetCents = Number(changes.dailyBudgetCents);
    if (!Number.isInteger(dailyBudgetCents) || dailyBudgetCents < 500 || dailyBudgetCents > 50_000) return null;
    normalized.dailyBudgetCents = dailyBudgetCents;
  }
  if (Object.hasOwn(changes, "endDate")) {
    const endDate = typeof changes.endDate === "string" ? changes.endDate.trim() : "";
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? Date.parse(`${endDate}T00:00:00.000Z`) : Number.NaN;
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== endDate) return null;
    normalized.endDate = endDate;
  }
  if (Object.hasOwn(changes, "targetLocations")) {
    if (!Array.isArray(changes.targetLocations) || changes.targetLocations.length < 1 || changes.targetLocations.length > 20) return null;
    const targetLocations = changes.targetLocations.map((entry) => typeof entry === "string" ? entry.trim() : "");
    if (targetLocations.some((entry) => !entry || entry.length > 120)) return null;
    normalized.targetLocations = [...new Set(targetLocations)];
  }
  return Object.keys(normalized).length ? normalized : null;
}

function lifecycleRecovery(value: unknown): LifecycleRecovery | null {
  const recovery = record(record(value).inrcyLifecycleRecovery);
  const operation = recovery.operation;
  if (operation !== "update" && operation !== "pause" && operation !== "delete" && operation !== "initial_publish") return null;
  const previousStatus = recovery.previousStatus;
  const mode = recovery.mode;
  return {
    operation,
    previousStatus: previousStatus === "active" || previousStatus === "demo_paused" || previousStatus === "needs_review"
      ? previousStatus : null,
    changes: operation === "update" ? normalizedRecoveryChanges(recovery.changes) : {},
    mode: mode === "demo_paused" || mode === "live" ? mode : null,
  };
}

function withLifecycleRecovery(
  resources: unknown,
  operation: LifecycleClaimOperation,
  previousStatus: StableRemoteCampaignStatus | null,
  changes?: AdsCampaignLifecycleChanges,
  mode?: InitialPublishMode | null,
): Record<string, unknown> {
  return {
    ...withoutLifecycleMetadata(resources),
    inrcyLifecycleRecovery: {
      operation,
      previousStatus,
      recoveredAt: new Date().toISOString(),
      ...(operation === "update" ? { changes: changes || null } : {}),
      ...(operation === "initial_publish" && mode ? { mode } : {}),
    },
  };
}

async function recoverStaleLifecycleClaim(
  data: Record<string, unknown>,
  userId: string,
): Promise<NextResponse> {
  const resources = record(data.provider_resources);
  const claim = record(resources.inrcyLifecycleClaim);
  const claimedAt = typeof claim.claimedAt === "string" ? claim.claimedAt : "";
  const claimedTimestamp = Date.parse(claimedAt || String(data.updated_at || ""));
  const previousStatus = claim.previousStatus;
  const claimedOperation = claim.operation;
  const stableStatus: StableRemoteCampaignStatus | null = previousStatus === "active" || previousStatus === "demo_paused" || previousStatus === "needs_review"
    ? previousStatus : null;
  const hasLifecycleClaim = Boolean(stableStatus) && (claimedOperation === "update" || claimedOperation === "pause" || claimedOperation === "reconcile" || claimedOperation === "delete");
  const operation: LifecycleClaimOperation = hasLifecycleClaim ? claimedOperation as RemoteLifecycleOperation : "initial_publish";
  const staleAfterMs = (maxDuration + 120) * 1_000;

  if (!Number.isFinite(claimedTimestamp) || Date.now() - claimedTimestamp < staleAfterMs) {
    return NextResponse.json({ error: "Une opération est déjà en cours sur cette campagne. Actualisez iNrSend dans quelques instants." }, { status: 409 });
  }

  const recoveredStatus: StableRemoteCampaignStatus = operation === "reconcile" && stableStatus ? stableStatus : "needs_review";
  const recoveryMessage = operation === "reconcile"
    ? "La lecture précédente de la plateforme a été interrompue. Vous pouvez relancer la resynchronisation."
    : operation === "initial_publish"
      ? "La création initiale a été interrompue et son résultat distant est incertain. Contrôlez la plateforme avant toute autre action."
      : "Une modification précédente a été interrompue et son résultat distant est incertain. Resynchronisez la campagne avant toute autre action.";
  const recoveredAt = new Date().toISOString();
  const recoveredResources = operation === "reconcile"
    ? withoutLifecycleMetadata(resources)
    : withLifecycleRecovery(
      resources,
      operation,
      stableStatus,
      operation === "update" ? record(claim.changes) : undefined,
      operation === "initial_publish" && (claim.mode === "demo_paused" || claim.mode === "live") ? claim.mode : null,
    );
  const { data: recovered, error } = await supabaseAdmin.from("ads_campaigns").update({
    status: recoveredStatus,
    provider_resources: recoveredResources,
    last_error: recoveryMessage,
    updated_at: recoveredAt,
  }).eq("id", String(data.id || "")).eq("user_id", userId)
    .eq("status", "publishing").eq("updated_at", String(data.updated_at || ""))
    .select("id").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Impossible de libérer l’opération interrompue. Réessayez dans quelques instants." }, { status: 503 });
  }
  if (!recovered) {
    return NextResponse.json({ error: "Cette campagne a changé entre-temps. Actualisez iNrSend avant de recommencer." }, { status: 409 });
  }
  return NextResponse.json({
    error: operation === "reconcile"
      ? "La lecture interrompue a été libérée. Relancez maintenant la resynchronisation."
      : operation === "initial_publish"
        ? "La création interrompue a été placée en contrôle. Vérifiez la campagne sur la plateforme avant de poursuivre."
        : "L’opération interrompue a été placée en contrôle. Resynchronisez maintenant son statut avec la plateforme.",
    recovered: true,
    requiresReconcile: true,
  }, { status: 409 });
}

function messageFrom(error: unknown): string {
  return (error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "La plateforme publicitaire n’a pas pu terminer cette action.").slice(0, 1_000);
}

function remoteMayHaveChanged(error: unknown, provider: "google" | "meta"): boolean {
  if (error instanceof AdsLifecyclePersistenceError) return true;
  if (provider === "meta") {
    return error instanceof MetaAdsLifecycleError ? error.remoteMayHaveChanged : false;
  }
  if (error instanceof GoogleAdsRemoteCampaignError) {
    return error.code === "REMOTE_MUTATION_UNCONFIRMED";
  }
  if (error instanceof GoogleAdsApiError) return error.status >= 500;
  return true;
}

function providerChanges(changes: AdsCampaignLifecycleChanges) {
  return {
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.dailyBudgetCents !== undefined ? { dailyBudgetEuros: changes.dailyBudgetCents / 100 } : {}),
    ...(changes.endDate !== undefined ? { endDate: changes.endDate } : {}),
    ...(changes.targetLocations !== undefined ? { targetLocations: changes.targetLocations } : {}),
  };
}

function nextDraft(current: Record<string, unknown>, changes: AdsCampaignLifecycleChanges) {
  return {
    ...current,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.dailyBudgetCents !== undefined ? { dailyBudgetEuros: changes.dailyBudgetCents / 100 } : {}),
    ...(changes.endDate !== undefined ? { endDate: changes.endDate } : {}),
    ...(changes.targetLocations !== undefined ? { targetLocations: changes.targetLocations } : {}),
  };
}

async function authorizeRemoteLifecycle(request: Request, context: RouteContext, operation: "update" | "delete") {
  if (!adsRequestOriginAllowed(request)) return { response: adsBadOriginResponse() };
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) {
    return { response: errorResponse || NextResponse.json({ error: "Accès refusé." }, { status: 403 }) };
  }
  const { id } = await context.params;
  if (!ADS_CAMPAIGN_ID_PATTERN.test(id)) {
    return { response: NextResponse.json({ error: "Identifiant de campagne invalide." }, { status: 400 }) };
  }
  const limited = await enforceRateLimit({
    name: `ads_remote_campaign_${operation}`,
    identifier: user.authUserId,
    limit: operation === "delete" ? 10 : 30,
    window: "1 h",
  });
  if (limited) return { response: limited };

  const { data, error } = await supabaseAdmin.from("ads_campaigns")
    .select("id,provider,ad_account_id,name,daily_budget_cents,end_date,status,draft,provider_resources,published_at,updated_at,last_error")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Impossible de relire cette campagne." }, { status: 503 }) };
  if (!data) return { response: NextResponse.json({ error: "Campagne introuvable." }, { status: 404 }) };
  if (data.status === "publishing") {
    return { response: await recoverStaleLifecycleClaim(data as Record<string, unknown>, user.activeUserId) };
  }
  const campaign = data as RemoteCampaignRow;
  const localCleanupOnly = operation === "delete" && canDiscardInterruptedInitialPublish(campaign);
  if (!localCleanupOnly && !canManageRemoteAdsCampaign(data)) {
    return { response: NextResponse.json({ error: "Cette campagne distante ne peut pas être gérée depuis iNrSend dans son état actuel." }, { status: 409 }) };
  }

  if (localCleanupOnly) return { id, user, campaign, localCleanupOnly: true as const };

  const draft = record(campaign.draft);
  const draftAccountId = String(draft.adAccountId || "").replace(/^act_/, "").replace(/-/g, "");
  if (draft.provider !== campaign.provider || draftAccountId !== campaign.ad_account_id) {
    return { response: NextResponse.json({ error: "Les données locales ne correspondent plus au compte annonceur de cette campagne." }, { status: 409 }) };
  }

  try {
    const connection = await readAdsIntegration(user.activeUserId, campaign.provider);
    if (connection?.status !== "connected") {
      return { response: NextResponse.json({ error: "Reconnectez votre compte publicitaire avant de gérer cette campagne." }, { status: 409 }) };
    }
    const accounts = await listAdsAccounts(user.activeUserId, campaign.provider);
    const account = accounts.find((entry) => entry.id === campaign.ad_account_id && entry.currency === "EUR");
    if (!account) {
      return { response: NextResponse.json({ error: "Ce compte publicitaire n’est plus accessible avec la connexion actuelle." }, { status: 403 }) };
    }
    return { id, user, campaign, account, localCleanupOnly: false as const };
  } catch (connectionError) {
    return { response: NextResponse.json({ error: messageFrom(connectionError) }, { status: 502 }) };
  }
}

async function claimCampaign(campaign: RemoteCampaignRow, userId: string, request: LifecycleClaimRequest) {
  const claimedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("ads_campaigns").update({
    status: "publishing",
    provider_resources: {
      ...campaign.provider_resources,
      inrcyLifecycleClaim: {
        claimedAt,
        previousStatus: campaign.status,
        operation: request.action,
        ...(request.action === "update" ? { changes: request.changes } : {}),
        ...(request.action === "initial_publish" && request.mode ? { mode: request.mode } : {}),
      },
    },
    updated_at: claimedAt,
  }).eq("id", campaign.id).eq("user_id", userId)
    .eq("status", campaign.status).eq("updated_at", campaign.updated_at)
    .select("id").maybeSingle();
  if (error) return { error: "Le verrouillage de la campagne est momentanément indisponible.", claimedAt: null };
  if (!data) return { error: "Cette campagne a changé entre-temps. Actualisez iNrSend avant de recommencer.", claimedAt: null };
  return { error: null, claimedAt };
}

async function recoverCampaign(input: {
  campaign: RemoteCampaignRow;
  userId: string;
  claimedAt: string;
  unsafe: boolean;
  error: string;
  providerResources?: Record<string, unknown>;
  request: LifecycleClaimRequest;
  preserveRecovery?: boolean;
  recoveryPreviousStatus?: StableRemoteCampaignStatus | null;
  recoveryMode?: InitialPublishMode | null;
}): Promise<boolean> {
  const cleanResources = withoutLifecycleMetadata(input.providerResources || input.campaign.provider_resources);
  const requiresReview = input.unsafe || input.preserveRecovery === true;
  const recoveredResources = requiresReview
    ? withLifecycleRecovery(
      cleanResources,
      input.request.action,
      input.recoveryPreviousStatus === undefined ? input.campaign.status : input.recoveryPreviousStatus,
      input.request.action === "update" ? input.request.changes : undefined,
      input.request.action === "initial_publish" ? input.recoveryMode || input.request.mode : null,
    )
    : cleanResources;
  const { data, error } = await supabaseAdmin.from("ads_campaigns").update({
    status: requiresReview ? "needs_review" : input.campaign.status,
    provider_resources: recoveredResources,
    last_error: requiresReview ? input.error : input.campaign.last_error,
    updated_at: new Date().toISOString(),
  }).eq("id", input.campaign.id).eq("user_id", input.userId)
    .eq("status", "publishing").eq("updated_at", input.claimedAt)
    .select("id").maybeSingle();
  return !error && Boolean(data);
}

async function executeRemoteAction(input: {
  request: AdsCampaignLifecycleRequest;
  userId: string;
  campaign: RemoteCampaignRow;
  loginCustomerId?: string;
}): Promise<RemoteActionResult> {
  const { request, userId, campaign } = input;
  const recovery = request.action === "reconcile" ? lifecycleRecovery(campaign.provider_resources) : null;
  if (recovery?.operation === "update" && !recovery.changes) {
    throw new Error("La modification interrompue ne contient pas assez d’informations pour être resynchronisée automatiquement. Contrôlez-la sur la plateforme.");
  }
  if (recovery?.operation === "initial_publish" && !hasCompleteInitialPublishResources(campaign)) {
    throw new Error(hasProviderCampaignIdentifier(campaign)
      ? "La création initiale est incomplète sur la plateforme. Supprimez la campagne distante depuis iNrSend ou contrôlez-la dans le compte publicitaire."
      : "Aucun identifiant de campagne distante n’a été enregistré. Contrôlez le compte publicitaire puis utilisez le nettoyage local explicite.");
  }
  if (campaign.provider === "google") {
    const adapter = createGoogleAdsRemoteCampaignAdapter({
      userId,
      adAccountId: campaign.ad_account_id,
      providerResources: campaign.provider_resources,
      loginCustomerId: input.loginCustomerId,
    });
    if (request.action === "reconcile") {
      if (recovery?.operation === "update" && recovery.changes) {
        const result = await adapter.update(providerChanges(recovery.changes));
        return {
          providerResources: result.providerResources,
          status: result.status === "ENABLED" ? "active" : "demo_paused",
          reconciledChanges: recovery.changes,
        };
      }
      if (recovery?.operation === "pause") {
        const result = await adapter.pause();
        return {
          providerResources: result.providerResources,
          status: "demo_paused",
        };
      }
      const snapshot = await adapter.read();
      if (snapshot.status === "REMOVED") {
        throw new GoogleAdsRemoteCampaignError("REMOTE_CAMPAIGN_REMOVED", "Cette campagne a déjà été supprimée de Google Ads.");
      }
      return {
        providerResources: campaign.provider_resources,
        status: snapshot.status === "ENABLED" ? "active" as const : "demo_paused" as const,
      };
    }
    const result = request.action === "update"
      ? await adapter.update(providerChanges(request.changes))
      : await adapter.pause();
    return {
      providerResources: result.providerResources,
      status: result.status === "ENABLED" ? "active" as const : "demo_paused" as const,
    };
  }

  const common = {
    adAccountId: campaign.ad_account_id,
    resources: campaign.provider_resources,
  };
  if (request.action === "reconcile") {
    if (recovery?.operation === "update" && recovery.changes) {
      const result = await updateMetaAdsCampaign(userId, {
        ...common,
        changes: recovery.changes,
      });
      return {
        providerResources: {
          ...result.resources,
          lifecycleState: result.state,
          lifecycleUpdatedAt: new Date().toISOString(),
        },
        status: result.state === "active" ? "active" : "demo_paused",
        reconciledChanges: recovery.changes,
      };
    }
    if (recovery?.operation === "pause") {
      const result = await setMetaAdsCampaignPaused(userId, { ...common, paused: true });
      return {
        providerResources: {
          ...result.resources,
          lifecycleState: result.state,
          lifecycleUpdatedAt: new Date().toISOString(),
        },
        status: "demo_paused",
      };
    }
    const state = await readMetaAdsCampaignState(userId, common);
    return {
      providerResources: {
        ...campaign.provider_resources,
        lifecycleState: state,
        lifecycleUpdatedAt: new Date().toISOString(),
      },
      status: state === "active" ? "active" as const : "demo_paused" as const,
    };
  }
  const result = request.action === "update"
    ? await updateMetaAdsCampaign(userId, {
      ...common,
      changes: {
        ...(request.changes.name !== undefined ? { name: request.changes.name } : {}),
        ...(request.changes.dailyBudgetCents !== undefined ? { dailyBudgetCents: request.changes.dailyBudgetCents } : {}),
        ...(request.changes.endDate !== undefined ? { endDate: request.changes.endDate } : {}),
        ...(request.changes.targetLocations !== undefined ? { targetLocations: request.changes.targetLocations } : {}),
      },
    })
    : await setMetaAdsCampaignPaused(userId, { ...common, paused: true });
  return {
    providerResources: {
      ...result.resources,
      lifecycleState: result.state,
      lifecycleUpdatedAt: new Date().toISOString(),
    },
    status: result.state === "active" ? "active" as const
      : result.state === "paused" ? "demo_paused" as const
        : campaign.status === "demo_paused" ? "demo_paused" as const : "active" as const,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorized = await authorizeRemoteLifecycle(request, context, "update");
  if ("response" in authorized) return authorized.response;
  if (authorized.localCleanupOnly) {
    return NextResponse.json({ error: "Cette reprise ne peut être nettoyée que par une suppression locale explicite." }, { status: 409 });
  }
  const { campaign, user, account } = authorized;
  const body = await request.json().catch(() => null);
  const parsed = parseAdsCampaignLifecycleRequest(body);
  if (!parsed.request) return NextResponse.json({ error: parsed.error || "Action invalide." }, { status: 400 });
  if (campaign.status === "needs_review" && parsed.request.action !== "reconcile") {
    return NextResponse.json({ error: "Contrôlez d’abord cette campagne sur la plateforme avant de la modifier ou de la réactiver." }, { status: 409 });
  }
  const pendingRecovery = parsed.request.action === "reconcile" ? lifecycleRecovery(campaign.provider_resources) : null;
  const effectiveRequest: LifecycleClaimRequest = pendingRecovery?.operation === "update"
    ? { action: "update", changes: pendingRecovery.changes || {} }
    : pendingRecovery?.operation === "pause"
      ? { action: "pause", changes: {} }
      : pendingRecovery?.operation === "delete"
        ? { action: "delete", changes: {} }
        : pendingRecovery?.operation === "initial_publish"
          ? { action: "initial_publish", changes: {}, mode: pendingRecovery.mode }
          : parsed.request;
  const claimed = await claimCampaign(campaign, user.activeUserId, effectiveRequest);
  if (!claimed.claimedAt) return NextResponse.json({ error: claimed.error }, { status: 409 });
  let providerResources = campaign.provider_resources;
  try {
    const remote = await executeRemoteAction({
      request: parsed.request,
      userId: user.activeUserId,
      campaign,
      loginCustomerId: account.loginCustomerId,
    });
    providerResources = remote.providerResources;
    const appliedChanges = parsed.request.action === "update" ? parsed.request.changes : remote.reconciledChanges || {};
    const draft = Object.keys(appliedChanges).length ? nextDraft(campaign.draft, appliedChanges) : campaign.draft;
    const completedAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("ads_campaigns").update({
      status: remote.status,
      name: String(draft.name || campaign.name),
      daily_budget_cents: appliedChanges.dailyBudgetCents ?? campaign.daily_budget_cents,
      end_date: typeof draft.endDate === "string" ? draft.endDate : campaign.end_date,
      draft,
      provider_resources: withoutLifecycleMetadata(providerResources),
      last_error: null,
      published_at: remote.status === "active" ? campaign.published_at || completedAt : campaign.published_at,
      updated_at: completedAt,
    }).eq("id", campaign.id).eq("user_id", user.activeUserId)
      .eq("status", "publishing").eq("updated_at", claimed.claimedAt)
      .select("id,name,daily_budget_cents,end_date,status,draft,provider_resources,published_at").maybeSingle();
    if (error || !data) {
      throw new AdsLifecyclePersistenceError("La plateforme a accepté la modification, mais iNrSend n’a pas pu confirmer son nouvel état.");
    }
    return NextResponse.json({ campaign: data });
  } catch (lifecycleError) {
    const error = messageFrom(lifecycleError);
    const unsafe = remoteMayHaveChanged(lifecycleError, campaign.provider);
    const recovered = await recoverCampaign({
      campaign,
      userId: user.activeUserId,
      claimedAt: claimed.claimedAt,
      unsafe,
      error,
      providerResources,
      request: effectiveRequest,
      preserveRecovery: Boolean(pendingRecovery),
      recoveryPreviousStatus: pendingRecovery?.previousStatus,
      recoveryMode: pendingRecovery?.mode,
    });
    if (!recovered) {
      return NextResponse.json({ error: `${error} iNrSend n’a pas pu libérer l’opération : utilisez le contrôle de l’opération depuis le détail de la campagne.` }, { status: 503 });
    }
    return NextResponse.json({
      error: unsafe
        ? `${error} Contrôlez la campagne sur la plateforme avant de réessayer.`
        : error,
    }, { status: unsafe ? 502 : 422 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorized = await authorizeRemoteLifecycle(request, context, "delete");
  if ("response" in authorized) return authorized.response;
  const { campaign, user } = authorized;
  const body = await request.json().catch(() => null);
  if (authorized.localCleanupOnly) {
    if (!hasLocalRecoveryDiscardConfirmation(body)) {
      return NextResponse.json({ error: "Confirmez explicitement le nettoyage local de cette création interrompue." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("ads_campaigns").delete()
      .eq("id", campaign.id).eq("user_id", user.activeUserId)
      .eq("status", "needs_review").eq("updated_at", campaign.updated_at)
      .select("id").maybeSingle();
    if (error) return NextResponse.json({ error: "Le nettoyage local est momentanément indisponible." }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Cette campagne a changé entre-temps. Actualisez iNrSend avant de recommencer." }, { status: 409 });
    return NextResponse.json({ deletedId: data.id, provider: campaign.provider, localOnly: true });
  }
  const { account } = authorized;
  if (!hasRemoteDeleteConfirmation(body)) {
    return NextResponse.json({ error: "Confirmez explicitement la suppression distante de cette campagne." }, { status: 400 });
  }

  const deleteRequest = { action: "delete" as const, changes: {} };
  const claimed = await claimCampaign(campaign, user.activeUserId, deleteRequest);
  if (!claimed.claimedAt) return NextResponse.json({ error: claimed.error }, { status: 409 });
  let providerResources = campaign.provider_resources;
  try {
    if (campaign.provider === "google") {
      const adapter = createGoogleAdsRemoteCampaignAdapter({
        userId: user.activeUserId,
        adAccountId: campaign.ad_account_id,
        providerResources: campaign.provider_resources,
        loginCustomerId: account.loginCustomerId,
      });
      const result = await adapter.remove();
      providerResources = result.providerResources;
    } else {
      const result = await deleteMetaAdsCampaign(user.activeUserId, {
        adAccountId: campaign.ad_account_id,
        resources: campaign.provider_resources,
      });
      providerResources = { ...result.resources, lifecycleState: "deleted", lifecycleUpdatedAt: new Date().toISOString() };
    }

    const { data, error } = await supabaseAdmin.from("ads_campaigns").delete()
      .eq("id", campaign.id).eq("user_id", user.activeUserId)
      .eq("status", "publishing").eq("updated_at", claimed.claimedAt)
      .select("id").maybeSingle();
    if (error || !data) {
      throw new AdsLifecyclePersistenceError("La campagne a été supprimée sur la plateforme, mais iNrSend n’a pas pu retirer sa ligne.");
    }
    return NextResponse.json({ deletedId: data.id, provider: campaign.provider });
  } catch (lifecycleError) {
    const error = messageFrom(lifecycleError);
    const unsafe = remoteMayHaveChanged(lifecycleError, campaign.provider);
    const recovered = await recoverCampaign({ campaign, userId: user.activeUserId, claimedAt: claimed.claimedAt, unsafe, error, providerResources, request: deleteRequest });
    if (!recovered) {
      return NextResponse.json({ error: `${error} iNrSend n’a pas pu libérer l’opération : utilisez le contrôle de l’opération depuis le détail de la campagne.` }, { status: 503 });
    }
    return NextResponse.json({
      error: `${error}${unsafe ? " Contrôlez la campagne sur la plateforme avant de réessayer." : ""}`,
    }, { status: unsafe ? 502 : 422 });
  }
}
