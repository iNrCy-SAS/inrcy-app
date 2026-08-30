import { supabaseAdmin } from "@/lib/supabaseAdmin";
export { isExistingAuthUserError } from "@/lib/supabaseAuthErrorPolicy";

export async function hasKnownInrcyAccountForEmail(rawEmail: unknown) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) return false;

  const [profileByAdmin, profileByContact, subscriptionByContact] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("user_id")
        .ilike("admin_email", email)
        .limit(1),
      supabaseAdmin
        .from("profiles")
        .select("user_id")
        .ilike("contact_email", email)
        .limit(1),
      supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .ilike("contact_email", email)
        .limit(1),
    ]);

  const errors = [
    profileByAdmin.error,
    profileByContact.error,
    subscriptionByContact.error,
  ].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0];
  }

  return [profileByAdmin.data, profileByContact.data, subscriptionByContact.data]
    .some((rows) => Array.isArray(rows) && rows.length > 0);
}
