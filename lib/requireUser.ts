import "server-only";

import type { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import { registerAuthenticatedDiagnosticScope } from "@/lib/observability/accountDiagnostics";

export async function requireUser() {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return {
      supabase: null as any,
      user: null as any,
      authUserId: "",
      activeUserId: "",
      activeAccount: null,
      accountScope: null,
      errorResponse: jsonUserFacingError("Votre session a expiré. Merci de vous reconnecter.", { status: 401, code: "auth_required" }),
    };
  }

  try {
    const accountScope = await resolveInrcyAccountScopeForUser(supabase, data.user);
    registerAuthenticatedDiagnosticScope({ accountId: accountScope.activeUserId, actorUserId: data.user.id });

    return {
      supabase,
      user: data.user,
      authUserId: data.user.id,
      activeUserId: accountScope.activeUserId,
      activeAccount: accountScope.activeAccount,
      accountScope,
      errorResponse: null as NextResponse | null,
    };
  } catch {
    // Fail closed: never silently fall back to another establishment when the
    // membership scope cannot be resolved.
    return {
      supabase,
      user: data.user,
      authUserId: data.user.id,
      activeUserId: "",
      activeAccount: null,
      accountScope: null,
      errorResponse: jsonUserFacingError(
        "Impossible de déterminer l’établissement actif. Merci de rafraîchir la page.",
        { status: 503, code: "account_scope_unavailable" },
      ),
    };
  }
}
