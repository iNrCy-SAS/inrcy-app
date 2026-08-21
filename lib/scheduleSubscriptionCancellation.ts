import "server-only";

import { stripeGet, stripePost } from "@/lib/stripeRest";
import { stripeSubscriptionPeriodEndUnix } from "@/lib/stripeSubscription";
import { stripeCancellationSchedule } from "@/lib/subscriptionCancellation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SubscriptionRow = {
  stripe_subscription_id?: string | null;
  billing_provider?: string | null;
  status?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
  next_renewal_date?: string | null;
  native_expires_at?: string | null;
  native_will_renew?: boolean | null;
};

export type SubscriptionCancellationPolicy =
  | "already_scheduled"
  | "one_additional_monthly_renewal"
  | "trial_end_without_charge"
  | "current_annual_period_end"
  | "native_expiration";

export type ScheduleSubscriptionCancellationResult = {
  endDate: string;
  nextRenewalDate: string | null;
  policy: SubscriptionCancellationPolicy;
  cancellationWasJustRequested: boolean;
  billingProvider: "stripe" | "app_store" | "play_store" | "manual";
};

export class SubscriptionCancellationError extends Error {
  readonly code:
    | "NATIVE_MANAGEMENT_REQUIRED"
    | "BILLING_MANAGEMENT_REQUIRED"
    | "NO_ACTIVE_SUBSCRIPTION";
  readonly provider: "app_store" | "play_store" | "manual" | null;

  constructor(
    code: SubscriptionCancellationError["code"],
    message: string,
    provider: SubscriptionCancellationError["provider"] = null,
  ) {
    super(message);
    this.name = "SubscriptionCancellationError";
    this.code = code;
    this.provider = provider;
  }
}

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidDate(value: string | null | undefined): value is string {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

function ymdFromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function endOfDateUtc(ymd: string): string {
  return `${ymd}T23:59:59.999Z`;
}

function futureDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? endOfDateUtc(value) : value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return null;
  return value.slice(0, 10);
}

async function updateSubscriptionCancellation(
  userId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function loadSubscriptionForCancellation(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "stripe_subscription_id,billing_provider,status,cancel_requested_at,end_date,next_renewal_date,native_expires_at,native_will_renew",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SubscriptionRow | null) ?? null;
}

/**
 * Programme une résiliation qui conserve l’accès jusqu’à sa vraie échéance.
 * Le mensuel conserve le renouvellement complet prévu par le préavis iNrCy ;
 * l’annuel s’arrête à la période déjà payée. Pour un abonnement natif, la
 * résiliation doit d’abord être faite dans le magasin, puis RevenueCat fournit
 * la date d’expiration à utiliser.
 */
export async function scheduleSubscriptionCancellationForUser(
  userId: string,
): Promise<ScheduleSubscriptionCancellationResult> {
  const row = await loadSubscriptionForCancellation(userId);
  if (!row) {
    throw new SubscriptionCancellationError(
      "NO_ACTIVE_SUBSCRIPTION",
      "Aucun abonnement actif n’a été trouvé pour ce compte.",
    );
  }

  const existingEndDate = futureDateOnly(row.end_date);
  if ((row.cancel_requested_at || normalize(row.status) === "canceled") && existingEndDate) {
    return {
      endDate: existingEndDate,
      nextRenewalDate: row.next_renewal_date?.slice(0, 10) ?? null,
      policy: "already_scheduled",
      cancellationWasJustRequested: false,
      billingProvider:
        normalize(row.billing_provider) === "app_store" || normalize(row.billing_provider) === "play_store"
          ? (normalize(row.billing_provider) as "app_store" | "play_store")
          : "stripe",
    };
  }

  const provider = normalize(row.billing_provider);
  if (provider === "app_store" || provider === "play_store") {
    const nativeEndDate =
      futureDateOnly(row.native_expires_at) || futureDateOnly(row.end_date);

    if (row.native_will_renew !== false || !nativeEndDate) {
      throw new SubscriptionCancellationError(
        "NATIVE_MANAGEMENT_REQUIRED",
        provider === "app_store"
          ? "Résiliez d’abord cet abonnement dans l’App Store, puis revenez ici pour programmer la suppression du compte."
          : "Résiliez d’abord cet abonnement dans Google Play, puis revenez ici pour programmer la suppression du compte.",
        provider,
      );
    }

    await updateSubscriptionCancellation(userId, {
      cancel_requested_at: new Date().toISOString(),
      end_date: nativeEndDate,
    });

    return {
      endDate: nativeEndDate,
      nextRenewalDate: row.next_renewal_date?.slice(0, 10) ?? nativeEndDate,
      policy: "native_expiration",
      cancellationWasJustRequested: true,
      billingProvider: provider,
    };
  }

  const stripeSubscriptionId = row.stripe_subscription_id?.trim();
  if (!stripeSubscriptionId) {
    const manualEndDate = futureDateOnly(row.end_date);
    if (row.cancel_requested_at && manualEndDate) {
      return {
        endDate: manualEndDate,
        nextRenewalDate: row.next_renewal_date?.slice(0, 10) ?? null,
        policy: "already_scheduled",
        cancellationWasJustRequested: false,
        billingProvider: "manual",
      };
    }

    throw new SubscriptionCancellationError(
      "BILLING_MANAGEMENT_REQUIRED",
      "La gestion de cet abonnement doit être confirmée par iNrCy avant de programmer sa suppression.",
      "manual",
    );
  }

  const currentSubscription = await stripeGet(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
  );
  const currentPeriodEndUnix = stripeSubscriptionPeriodEndUnix(currentSubscription);
  if (!currentPeriodEndUnix) {
    throw new Error("Stripe n’a pas renvoyé la date de la période en cours.");
  }

  const schedule = stripeCancellationSchedule(currentSubscription, currentPeriodEndUnix);
  const cancellationParams = new URLSearchParams();

  if (schedule.mode === "custom") {
    cancellationParams.set("cancel_at_period_end", "false");
    cancellationParams.set("cancel_at", String(schedule.cancelAtUnix));
    cancellationParams.set("proration_behavior", "none");
  } else {
    cancellationParams.set("cancel_at_period_end", "true");
  }

  const updated = await stripePost(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    cancellationParams,
  );

  const returnedCancelAtUnix = Number(updated?.cancel_at);
  const cancelAtUnix = Number.isFinite(returnedCancelAtUnix) && returnedCancelAtUnix > 0
    ? returnedCancelAtUnix
    : schedule.cancelAtUnix;
  const cancelEndDate = ymdFromDate(new Date(cancelAtUnix * 1000));
  const nextRenewalDate = ymdFromDate(new Date(currentPeriodEndUnix * 1000));

  if (!isValidDate(cancelEndDate)) {
    throw new Error("Stripe n’a pas renvoyé la date de résiliation programmée.");
  }

  await updateSubscriptionCancellation(userId, {
    cancel_requested_at: new Date().toISOString(),
    end_date: cancelEndDate,
    status: updated.status,
    next_renewal_date: nextRenewalDate,
  });

  return {
    endDate: cancelEndDate,
    nextRenewalDate,
    policy:
      schedule.mode === "custom"
        ? "one_additional_monthly_renewal"
        : schedule.mode === "trial_end"
          ? "trial_end_without_charge"
          : "current_annual_period_end",
    cancellationWasJustRequested: true,
    billingProvider: "stripe",
  };
}

/**
 * Pour une suppression immédiate, on bloque tout renouvellement futur mais on
 * ne fabrique pas de prorata ni de remboursement automatique : le compte est
 * supprimé tout de suite, tandis que la période déjà payée n’est pas prolongée.
 */
export async function stopFutureSubscriptionRenewalsForImmediateDeletion(userId: string) {
  const row = await loadSubscriptionForCancellation(userId);
  if (!row) return { billingProvider: "none" as const };

  const provider = normalize(row.billing_provider);
  if (provider === "app_store" || provider === "play_store") {
    if (row.native_will_renew === false || row.status === "canceled") {
      return { billingProvider: provider as "app_store" | "play_store" };
    }
    throw new SubscriptionCancellationError(
      "NATIVE_MANAGEMENT_REQUIRED",
      provider === "app_store"
        ? "Résiliez d’abord l’abonnement dans l’App Store avant de supprimer immédiatement le compte."
        : "Résiliez d’abord l’abonnement dans Google Play avant de supprimer immédiatement le compte.",
      provider,
    );
  }

  const stripeSubscriptionId = row.stripe_subscription_id?.trim();
  if (!stripeSubscriptionId) {
    if (row.cancel_requested_at || normalize(row.status) === "canceled") {
      return { billingProvider: "manual" as const };
    }
    throw new SubscriptionCancellationError(
      "BILLING_MANAGEMENT_REQUIRED",
      "La gestion de cet abonnement doit être confirmée par iNrCy avant une suppression immédiate.",
      "manual",
    );
  }

  const currentSubscription = await stripeGet(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
  );
  const currentStatus = normalize(currentSubscription?.status);
  if (currentStatus === "canceled" || currentSubscription?.cancel_at_period_end === true) {
    return { billingProvider: "stripe" as const };
  }

  const currentPeriodEndUnix = stripeSubscriptionPeriodEndUnix(currentSubscription);
  if (!currentPeriodEndUnix) {
    throw new Error("Stripe n’a pas renvoyé la date de fin de la période en cours.");
  }

  const updated = await stripePost(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    new URLSearchParams({
      cancel_at_period_end: "true",
      proration_behavior: "none",
    }),
  );

  await updateSubscriptionCancellation(userId, {
    cancel_requested_at: new Date().toISOString(),
    end_date: ymdFromDate(new Date(currentPeriodEndUnix * 1000)),
    status: updated.status,
    next_renewal_date: ymdFromDate(new Date(currentPeriodEndUnix * 1000)),
  });

  return { billingProvider: "stripe" as const };
}

export async function restoreSubscriptionRenewalForUser(userId: string) {
  const row = await loadSubscriptionForCancellation(userId);
  if (!row) {
    throw new SubscriptionCancellationError(
      "NO_ACTIVE_SUBSCRIPTION",
      "Aucun abonnement actif n’a été trouvé pour ce compte.",
    );
  }

  const provider = normalize(row.billing_provider);
  if (provider === "app_store" || provider === "play_store") {
    throw new SubscriptionCancellationError(
      "NATIVE_MANAGEMENT_REQUIRED",
      provider === "app_store"
        ? "La réactivation se fait directement dans l’App Store."
        : "La réactivation se fait directement dans Google Play.",
      provider,
    );
  }

  const stripeSubscriptionId = row.stripe_subscription_id?.trim();
  if (!stripeSubscriptionId) {
    throw new SubscriptionCancellationError(
      "BILLING_MANAGEMENT_REQUIRED",
      "La gestion de cet abonnement doit être confirmée par iNrCy.",
      "manual",
    );
  }

  const updated = await stripePost(
    `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    new URLSearchParams({
      cancel_at: "",
      cancel_at_period_end: "false",
      proration_behavior: "none",
    }),
  );

  await updateSubscriptionCancellation(userId, {
    cancel_requested_at: null,
    end_date: null,
    status: updated.status,
    next_renewal_date: stripeSubscriptionPeriodEndUnix(updated)
      ? ymdFromDate(new Date(stripeSubscriptionPeriodEndUnix(updated)! * 1000))
      : null,
  });

  return { billingProvider: "stripe" as const };
}
