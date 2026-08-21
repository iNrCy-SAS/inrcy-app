import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DeleteResult = {
  ok: boolean;
  mode: "rpc" | "fallback";
  details: Record<string, string>;
};

const BUSINESS_TABLES_IN_DELETE_ORDER = [
  "publication_deliveries",
  "publications",
  "site_articles",
  "doc_saves",
  "boutique_orders",
  "inrsend_history_files",
  "send_items",
  "crm_contacts",
  "agenda_events",
  "integrations",
  "pro_tools_configs",
  "inrcy_site_configs",
  "business_profiles",
  "stats_cache",
  "loyalty_ledger",
  "loyalty_balance",
  "app_events",
  "profiles",
] as const;

async function safeDeleteByUserId(table: string, userId: string) {
  try {
    const { error } = await supabaseAdmin.from(table).delete().eq("user_id", userId);
    return error ? error.message : null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "unknown";
  }
}

export async function listManagedAccountIds(authUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("account_id")
    .eq("auth_user_id", authUserId);

  if (error) {
    throw new Error(`INRCY_ACCOUNT_DELETE_SCOPE_UNAVAILABLE:${error.message || "membership_query_failed"}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("INRCY_ACCOUNT_DELETE_SCOPE_UNAVAILABLE:invalid_membership_payload");
  }

  const accountIds = Array.from(
    new Set(
      data
        .map((row) => String((row as { account_id?: unknown }).account_id || ""))
        .filter(Boolean),
    ),
  );

  // Suppression RGPD fail-closed : ne jamais détruire le compte AUTH si le scope
  // multicompte est vide ou si l'établissement principal n'est pas visible.
  if (accountIds.length === 0 || !accountIds.includes(authUserId)) {
    throw new Error("INRCY_ACCOUNT_DELETE_SCOPE_INCOMPLETE");
  }

  return accountIds;
}

async function fallbackDeleteBusinessAccount(accountId: string, errors: Record<string, string>) {
  for (const table of BUSINESS_TABLES_IN_DELETE_ORDER) {
    const err = await safeDeleteByUserId(table, accountId);
    if (err) errors[`${accountId}:${table}`] = err;
  }
}

async function cleanupMulticompteRows(authUserId: string, accountIds: string[], errors: Record<string, string>) {
  try {
    const { error } = await supabaseAdmin
      .from("inrcy_account_members")
      .delete()
      .eq("auth_user_id", authUserId);
    if (error) errors["inrcy_account_members"] = error.message;
  } catch (e: unknown) {
    errors["inrcy_account_members"] = e instanceof Error ? e.message : "unknown";
  }

  try {
    const { error } = await supabaseAdmin
      .from("inrcy_multi_account_config")
      .delete()
      .eq("auth_user_id", authUserId);
    if (error) errors["inrcy_multi_account_config"] = error.message;
  } catch (e: unknown) {
    errors["inrcy_multi_account_config"] = e instanceof Error ? e.message : "unknown";
  }

  for (const accountId of accountIds) {
    try {
      const { error } = await supabaseAdmin.from("inrcy_accounts").delete().eq("id", accountId);
      if (error) errors[`inrcy_accounts:${accountId}`] = error.message;
    } catch (e: unknown) {
      errors[`inrcy_accounts:${accountId}`] = e instanceof Error ? e.message : "unknown";
    }
  }
}

export async function deleteUserAccountEverywhere(authUserId: string): Promise<DeleteResult> {
  const errors: Record<string, string> = {};
  const accountIds = await listManagedAccountIds(authUserId);
  const secondaryAccountIds = accountIds.filter((accountId) => accountId !== authUserId);
  let usedFallback = false;

  // Les établissements secondaires n'ont pas de compte AUTH propre. On tente d'abord
  // la RPC RGPD historique pour bénéficier de son nettoyage exhaustif, puis on retombe
  // sur le nettoyage applicatif connu si cette RPC exige un auth.users correspondant.
  for (const accountId of secondaryAccountIds) {
    try {
      const { error } = await supabaseAdmin.rpc("delete_user_rgpd", { uid: accountId });
      if (error) {
        usedFallback = true;
        await fallbackDeleteBusinessAccount(accountId, errors);
      }
    } catch (e: unknown) {
      usedFallback = true;
      await fallbackDeleteBusinessAccount(accountId, errors);
    }
  }

  // Le compte principal conserve le comportement historique. subscriptions reste AUTH-global.
  try {
    const { error: rpcErr } = await supabaseAdmin.rpc("delete_user_rgpd", { uid: authUserId });
    if (rpcErr) {
      usedFallback = true;
      await fallbackDeleteBusinessAccount(authUserId, errors);
      const subscriptionErr = await safeDeleteByUserId("subscriptions", authUserId);
      if (subscriptionErr) errors["subscriptions"] = subscriptionErr;
    }
  } catch (e: unknown) {
    usedFallback = true;
    await fallbackDeleteBusinessAccount(authUserId, errors);
    const subscriptionErr = await safeDeleteByUserId("subscriptions", authUserId);
    if (subscriptionErr) errors["subscriptions"] = subscriptionErr;
  }

  // Ne jamais supprimer l’identité AUTH après un nettoyage métier incomplet.
  // Le compte reste alors authentifiable afin que l’opération puisse être
  // relancée ou prise en charge, au lieu de laisser une session fantôme et des
  // données devenues inaccessibles.
  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      mode: usedFallback ? "fallback" : "rpc",
      details: errors,
    };
  }

  await cleanupMulticompteRows(authUserId, accountIds, errors);

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      mode: usedFallback ? "fallback" : "rpc",
      details: errors,
    };
  }

  const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
  if (authErr) errors["auth"] = authErr.message;

  return {
    ok: Object.keys(errors).length === 0,
    mode: usedFallback ? "fallback" : "rpc",
    details: errors,
  };
}
