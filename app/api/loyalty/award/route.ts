import { NextResponse } from "next/server";
import { awardInertiaActionForUser, type InertiaActionKey } from "@/lib/loyalty/serverAward";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getIsoWeekId } from "@/lib/weeklyGoals";
import {
  getDashboardEditionForAccountId,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";

type AwardBody = {
  actionKey: string;
  amount: number;
  sourceId?: string | null;
  label?: string | null;
  meta?: Record<string, unknown> | null;
};

const ALLOWED_ACTION_KEYS = new Set<InertiaActionKey>([
  "account_open",
  "profile_complete",
  "activity_complete",
  "connect_channel",
  "create_actu",
  "weekly_feature_use",
  "weekly_propulser_use",
  "weekly_fideliser_use",
  "monthly_seniority",
]);

const PREMIUM_ONLY_ACTION_KEYS = new Set<InertiaActionKey>([
  "weekly_feature_use",
  "weekly_propulser_use",
  "weekly_fideliser_use",
]);

const DEFAULT_LABELS: Record<InertiaActionKey, string> = {
  account_open: "Ouverture du compte",
  profile_complete: "Profil complete",
  activity_complete: "Activite complete",
  connect_channel: "Canal connecte",
  create_actu: "Actu creee",
  weekly_feature_use: "Action hebdomadaire",
  weekly_propulser_use: "Action Propulser",
  weekly_fideliser_use: "Action Fideliser",
  monthly_seniority: "Anciennete",
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function asActionKey(value: string): InertiaActionKey | null {
  const actionKey = value.trim() as InertiaActionKey;
  return ALLOWED_ACTION_KEYS.has(actionKey) ? actionKey : null;
}

function defaultSourceId(actionKey: InertiaActionKey) {
  const today = new Date().toISOString().slice(0, 10);
  if (actionKey === "create_actu" || actionKey === "weekly_feature_use" || actionKey === "weekly_propulser_use" || actionKey === "weekly_fideliser_use") {
    return `week-${getIsoWeekId()}`;
  }
  if (actionKey === "monthly_seniority") {
    return `seniority-${today.slice(0, 7)}`;
  }
  return "once";
}

export async function POST(req: Request) {
  let body: AwardBody;

  try {
    body = (await req.json()) as AwardBody;
  } catch {
    return badRequest("Body JSON invalide.");
  }

  const actionKey = asActionKey(String(body.actionKey ?? ""));
  const amount = Number(body.amount);

  if (!actionKey) return badRequest("actionKey non autorisee.");
  if (!Number.isFinite(amount) || amount === 0) return badRequest("amount invalide (doit etre non nul).");
  if (amount < 0) return badRequest("amount negatif non autorise pour le moment.");

  const supabase = await createSupabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();

  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: "Non authentifie." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);
  const dashboardEdition = await getDashboardEditionForAccountId(activeUserId);
  if (dashboardEdition === "standard" && PREMIUM_ONLY_ACTION_KEYS.has(actionKey)) {
    return premiumRequiredApiResponse();
  }
  const sourceId = String(body.sourceId || defaultSourceId(actionKey)).trim();
  const label = String(body.label || DEFAULT_LABELS[actionKey]).trim();
  const result = await awardInertiaActionForUser({
    userId: activeUserId,
    actionKey,
    baseAmount: amount,
    sourceId,
    label,
    meta: body.meta ?? {},
  });

  return NextResponse.json(
    {
      ok: result.ok,
      skipped: result.skipped ?? false,
      amount: result.amount ?? null,
      balance: result.balance ?? null,
      updatedAt: result.updatedAt ?? null,
      error: result.error ?? null,
    },
    { status: result.ok ? 200 : 400 },
  );
}
