import "server-only";

import { listManagedAccountIds } from "@/lib/deleteUserAccount";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const PARTIAL_DATA_CATEGORIES = [
  "generated_content",
  "contacts",
  "connections",
  "documents",
  "activity",
] as const;

export type PartialDataCategory = (typeof PARTIAL_DATA_CATEGORIES)[number];

const TABLES_BY_CATEGORY: Record<PartialDataCategory, readonly string[]> = {
  // Child records come first so the operation remains safe when a deployment
  // has foreign-key constraints stricter than the historical RGPD RPC.
  generated_content: [
    "media_variants",
    "media_processing_jobs",
    "publication_workspace_media",
    "publication_workspaces",
    "pro_media_library",
  ],
  contacts: [
    "crm_contacts",
    "mail_suppression_list",
    "send_items",
    "inrsend_history_files",
  ],
  connections: ["integrations"],
  documents: ["doc_saves"],
  activity: [
    "notifications",
    "app_events",
    "stats_cache",
    "loyalty_ledger",
    "loyalty_balance",
  ],
};

function isOptionalSchemaMismatch(error: { code?: string | null; message?: string | null }) {
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("column user_id")
  );
}

async function deleteTableRows(table: string, accountId: string) {
  const { error } = await supabaseAdmin.from(table).delete().eq("user_id", accountId);
  if (error && !isOptionalSchemaMismatch(error)) {
    throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Supprime uniquement les familles de données explicitement choisies. Le
 * profil, l’identité, l’abonnement et les réglages de facturation restent
 * intacts ; une suppression complète passe par deleteUserAccountEverywhere.
 */
export async function deleteUserDataCategories(
  authUserId: string,
  categories: readonly string[],
) {
  const requested = Array.from(
    new Set(
      categories.filter((value): value is PartialDataCategory =>
        (PARTIAL_DATA_CATEGORIES as readonly string[]).includes(value),
      ),
    ),
  );

  if (requested.length === 0) {
    throw new Error("Sélectionnez au moins une catégorie de données.");
  }

  const accountIds = await listManagedAccountIds(authUserId);
  for (const category of requested) {
    for (const table of TABLES_BY_CATEGORY[category]) {
      for (const accountId of accountIds) {
        await deleteTableRows(table, accountId);
      }
    }
  }

  return requested;
}

