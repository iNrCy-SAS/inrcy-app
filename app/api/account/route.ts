import { NextResponse } from "next/server";
import { withApi } from "@/lib/observability/withApi";
import { requireUser } from "@/lib/requireUser";
import { deleteUserAccountEverywhere } from "@/lib/deleteUserAccount";

export const DELETE = withApi(async () => {
  const { supabase, user, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const deletion = await deleteUserAccountEverywhere(user.id);

  if (!deletion.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Suppression partielle. Certaines données n'ont pas pu être supprimées automatiquement.",
      },
      { status: 500 }
    );
  }

  // L’identité a bien été supprimée : expirer maintenant les cookies de cette
  // session. En cas d’échec partiel, on conserve au contraire l’accès afin que
  // la suppression puisse être relancée proprement.
  try {
    await supabase.auth.signOut();
  } catch {
    // Le client efface également sa session locale avant la redirection.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}, { route: "/api/account" });
