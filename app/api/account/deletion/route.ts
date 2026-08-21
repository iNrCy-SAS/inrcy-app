import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteUserAccountEverywhere } from "@/lib/deleteUserAccount";
import { deleteUserDataCategories } from "@/lib/deleteUserDataCategories";
import {
  restoreSubscriptionRenewalForUser,
  scheduleSubscriptionCancellationForUser,
  stopFutureSubscriptionRenewalsForImmediateDeletion,
  SubscriptionCancellationError,
} from "@/lib/scheduleSubscriptionCancellation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeletionMode = "end_of_access" | "immediate" | "partial" | "cancel_scheduled";

type DeletionRequestRow = {
  id?: string;
  user_id?: string;
  mode?: "end_of_access" | "immediate";
  status?: "scheduled" | "processing" | "completed" | "cancelled" | "failed";
  requested_at?: string | null;
  scheduled_for?: string | null;
  billing_provider?: string | null;
  subscription_cancellation_managed?: boolean | null;
  last_error?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
};

type SubscriptionRow = {
  plan?: string | null;
  status?: string | null;
  billing_provider?: string | null;
  billing_cycle?: string | null;
  next_renewal_date?: string | null;
  end_date?: string | null;
  cancel_requested_at?: string | null;
  native_expires_at?: string | null;
  native_will_renew?: boolean | null;
};

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isFuture(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
}

function scheduledFor(endDate: string) {
  return `${endDate.slice(0, 10)}T23:59:59.999Z`;
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /account_deletion_requests|could not find the table|relation .* does not exist|PGRST205/i.test(message);
}

function migrationRequiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "PRIVACY_MIGRATION_REQUIRED",
      error: "Le parcours de suppression doit encore être activé dans Supabase avec le script SQL fourni.",
    },
    { status: 503 },
  );
}

async function loadDeletionRequest(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id,user_id,mode,status,requested_at,scheduled_for,billing_provider,subscription_cancellation_managed,last_error,completed_at,cancelled_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DeletionRequestRow | null) ?? null;
}

async function loadSubscription(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("plan,status,billing_provider,billing_cycle,next_renewal_date,end_date,cancel_requested_at,native_expires_at,native_will_renew")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SubscriptionRow | null) ?? null;
}

function subscriptionEndDate(subscription: SubscriptionRow | null) {
  if (!subscription) return null;
  if (isFuture(subscription.end_date)) return subscription.end_date?.slice(0, 10) ?? null;
  if (subscription.native_will_renew === false && isFuture(subscription.native_expires_at)) {
    return subscription.native_expires_at?.slice(0, 10) ?? null;
  }
  return null;
}

function parseMode(value: unknown): DeletionMode | null {
  const mode = String(value || "").trim();
  return mode === "end_of_access" || mode === "immediate" || mode === "partial" || mode === "cancel_scheduled"
    ? mode
    : null;
}

async function cancelScheduledDeletion(userId: string) {
  const existing = await loadDeletionRequest(userId);
  if (!existing || existing.status !== "scheduled") {
    return { ok: true, cancelled: false };
  }

  if (existing.subscription_cancellation_managed) {
    await restoreSubscriptionRenewalForUser(userId);
  }

  const { error } = await supabaseAdmin
    .from("account_deletion_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("user_id", userId)
    .eq("status", "scheduled");
  if (error) throw new Error(error.message);

  return { ok: true, cancelled: true };
}

async function completeImmediateDeletion(
  userId: string,
  supabase: { auth: { signOut: () => Promise<unknown> } },
  billingProvider: string,
) {
  const deletion = await deleteUserAccountEverywhere(userId);
  if (!deletion.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "ACCOUNT_DELETION_INCOMPLETE",
        error: "Certaines données n’ont pas pu être supprimées. Votre compte reste accessible afin de permettre une nouvelle tentative.",
        details: deletion.details,
      },
      { status: 500 },
    );
  }

  const completedAt = new Date().toISOString();
  const { error: auditError } = await supabaseAdmin
    .from("account_deletion_requests")
    .upsert(
      {
        user_id: userId,
        mode: "immediate",
        status: "completed",
        requested_at: completedAt,
        scheduled_for: completedAt,
        billing_provider: billingProvider || "none",
        completed_at: completedAt,
        updated_at: completedAt,
        last_error: null,
      },
      { onConflict: "user_id" },
    );
  if (auditError && !schemaUnavailable(auditError)) {
    console.error("[account/deletion] audit completion failed", auditError.message);
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // The browser also clears its local session after the successful response.
  }

  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}

export async function GET() {
  const { user, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const [subscription, deletion] = await Promise.all([
      loadSubscription(user.id),
      loadDeletionRequest(user.id),
    ]);

    return NextResponse.json(
      {
        ok: true,
        authenticated: true,
        user: { email: user.email ?? null },
        subscription: subscription
          ? {
              plan: subscription.plan ?? null,
              status: subscription.status ?? null,
              billing_provider: subscription.billing_provider ?? null,
              billing_cycle: subscription.billing_cycle ?? null,
              next_renewal_date: subscription.next_renewal_date ?? null,
              end_date: subscription.end_date ?? null,
              cancel_requested_at: subscription.cancel_requested_at ?? null,
              native_expires_at: subscription.native_expires_at ?? null,
              native_will_renew: subscription.native_will_renew ?? null,
              access_end_date: subscriptionEndDate(subscription),
            }
          : null,
        deletion: deletion
          ? {
              mode: deletion.mode ?? null,
              status: deletion.status ?? null,
              scheduled_for: deletion.scheduled_for ?? null,
              billing_provider: deletion.billing_provider ?? null,
            }
          : null,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (schemaUnavailable(error)) return migrationRequiredResponse();
    console.error("[account/deletion] state failed", error);
    return NextResponse.json(
      { ok: false, error: "Impossible de charger l’état de votre demande pour le moment." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const { supabase, user, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  let body: { mode?: unknown; categories?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: 400 });
  }

  const mode = parseMode(body.mode);
  if (!mode) return NextResponse.json({ ok: false, error: "Action de confidentialité inconnue." }, { status: 400 });

  try {
    if (mode === "cancel_scheduled") {
      return NextResponse.json(await cancelScheduledDeletion(user.id));
    }

    if (mode === "partial") {
      const categories = Array.isArray(body.categories)
        ? body.categories.filter((value): value is string => typeof value === "string")
        : [];
      const deletedCategories = await deleteUserDataCategories(user.id, categories);
      return NextResponse.json({ ok: true, partial: true, categories: deletedCategories });
    }

    const existing = await loadDeletionRequest(user.id);
    if (mode === "end_of_access" && existing?.status === "scheduled") {
      return NextResponse.json({
        ok: true,
        scheduled: true,
        scheduled_for: existing.scheduled_for,
        billing_provider: existing.billing_provider,
      });
    }

    if (mode === "immediate") {
      const stopped = await stopFutureSubscriptionRenewalsForImmediateDeletion(user.id);
      return completeImmediateDeletion(user.id, supabase, stopped.billingProvider);
    }

    let cancellation;
    try {
      cancellation = await scheduleSubscriptionCancellationForUser(user.id);
    } catch (error) {
      if (error instanceof SubscriptionCancellationError && error.code === "NO_ACTIVE_SUBSCRIPTION") {
        const stopped = await stopFutureSubscriptionRenewalsForImmediateDeletion(user.id);
        return completeImmediateDeletion(user.id, supabase, stopped.billingProvider);
      }
      throw error;
    }

    const requestedAt = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("account_deletion_requests")
      .upsert(
        {
          user_id: user.id,
          mode: "end_of_access",
          status: "scheduled",
          requested_at: requestedAt,
          scheduled_for: scheduledFor(cancellation.endDate),
          billing_provider: cancellation.billingProvider,
          subscription_cancellation_managed: cancellation.cancellationWasJustRequested,
          last_error: null,
          completed_at: null,
          cancelled_at: null,
          updated_at: requestedAt,
        },
        { onConflict: "user_id" },
      );
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      scheduled: true,
      scheduled_for: scheduledFor(cancellation.endDate),
      end_date: cancellation.endDate,
      policy: cancellation.policy,
      billing_provider: cancellation.billingProvider,
    });
  } catch (error) {
    if (schemaUnavailable(error)) return migrationRequiredResponse();
    if (error instanceof SubscriptionCancellationError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, provider: error.provider },
        { status: error.code === "NO_ACTIVE_SUBSCRIPTION" ? 400 : 409 },
      );
    }
    console.error("[account/deletion] action failed", error);
    return NextResponse.json(
      { ok: false, error: "L’opération de confidentialité n’a pas pu être terminée. Merci de réessayer." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const { user, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    return NextResponse.json(await cancelScheduledDeletion(user.id));
  } catch (error) {
    if (schemaUnavailable(error)) return migrationRequiredResponse();
    if (error instanceof SubscriptionCancellationError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, provider: error.provider },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "La demande de suppression n’a pas pu être annulée." },
      { status: 500 },
    );
  }
}

