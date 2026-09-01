import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { ACTIVE_INRCY_ACCOUNT_COOKIE } from "@/lib/multicompte/constants";
import { isUuidLike } from "@/lib/multicompte/normalize";
import { listAccessibleInrcyAccounts, resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import { provisionNewAccountBubbleAccess } from "@/lib/appBubbleAccessProvisioning";
import { ensureInrcyAccountOnboardingState } from "@/lib/inrcyAccountProvisioning";

export const dynamic = "force-dynamic";

type CreateBody = {
  displayName?: unknown;
};

function cleanDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

type EstablishmentCreationError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function creationErrorMessage(error?: EstablishmentCreationError | null) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");

  if (message.includes("INRCY_MULTICOMPTE_DISABLED")) {
    return { status: 403, error: "Le multicompte n’est pas activé pour ce compte." };
  }
  if (message.includes("INRCY_ESTABLISHMENT_LIMIT_REACHED")) {
    return { status: 409, error: "Le nombre maximum d’établissements autorisés est atteint." };
  }
  if (message.includes("INRCY_ESTABLISHMENT_NAME_INVALID")) {
    return { status: 400, error: "Le nom de l’établissement doit contenir entre 2 et 120 caractères." };
  }
  if (code === "23503" || message.includes("INRCY_ACCOUNT_SCOPE_CONSTRAINT")) {
    return {
      status: 503,
      error: "La configuration multicompte doit être resynchronisée. Merci de réessayer dans quelques instants.",
    };
  }
  if (code === "23505") {
    return {
      status: 409,
      error: "Un conflit de données empêche la création de cet établissement. Rafraîchissez la page puis réessayez.",
    };
  }
  return { status: 500, error: "Impossible de créer l’établissement." };
}

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ ok: false, error: "Session expirée." }, { status: 401 });
  }

  try {
    const scope = await resolveInrcyAccountScopeForUser(supabase, data.user);

    return NextResponse.json({
      ok: true,
      authUserId: scope.authUserId,
      activeUserId: scope.activeUserId,
      accounts: scope.accounts,
      config: scope.config,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Impossible de charger les établissements pour le moment." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return NextResponse.json({ ok: false, error: "Session expirée." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as CreateBody;
  const displayName = cleanDisplayName(body.displayName);

  if (displayName.length < 2) {
    return NextResponse.json(
      { ok: false, error: "Le nom de l’établissement doit contenir au moins 2 caractères." },
      { status: 400 },
    );
  }

  const { data: accountId, error: createError } = await supabase.rpc("inrcy_create_establishment", {
    p_display_name: displayName,
  });

  if (createError || !isUuidLike(accountId)) {
    console.error("[multicompte] establishment creation failed", {
      authUserId: data.user.id,
      code: createError?.code || null,
      message: createError?.message || null,
      details: createError?.details || null,
      hint: createError?.hint || null,
      returnedAccountId: typeof accountId === "string" ? accountId : null,
    });

    const mapped = creationErrorMessage(createError);
    return NextResponse.json(
      { ok: false, error: mapped.error },
      { status: mapped.status },
    );
  }

  try {
    // Ne jamais ouvrir l'établissement tant que son parcours Profil / Activité /
    // Configuration IA n'est pas réellement présent en base.
    await ensureInrcyAccountOnboardingState(accountId);

    // The database migration also provisions these defaults, but the API repeats
    // the operation deliberately so a stale SQL function can never grant Site iNrCy.
    await provisionNewAccountBubbleAccess(accountId);
  } catch (provisioningError) {
    console.error("[multicompte] bubble access provisioning failed", {
      authUserId: data.user.id,
      accountId,
      error: provisioningError instanceof Error ? provisioningError.message : String(provisioningError),
    });
    return NextResponse.json(
      { ok: false, error: "L’établissement a été créé, mais sa configuration initiale n’a pas pu être vérifiée. Merci de réessayer." },
      { status: 503 },
    );
  }

  let accounts: Awaited<ReturnType<typeof listAccessibleInrcyAccounts>>;
  try {
    accounts = await listAccessibleInrcyAccounts(supabase, data.user.id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "L’établissement a été créé, mais son ouverture a échoué. Rafraîchissez la page." },
      { status: 503 },
    );
  }
  const createdAccount = accounts.find((account) => account.id === accountId) || null;

  const response = NextResponse.json({
    ok: true,
    activeUserId: accountId,
    account: createdAccount,
    accounts,
  });

  // La création ouvre immédiatement l'espace vierge. Un rechargement complet côté client
  // évite tout résidu de cache de l'établissement précédent.
  response.cookies.set(ACTIVE_INRCY_ACCOUNT_COOKIE, accountId, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
