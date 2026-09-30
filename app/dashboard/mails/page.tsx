import { createSupabaseServer } from "@/lib/supabaseServer";
import { isAdsUserAllowed } from "@/lib/adsServer";
import { resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import MailboxPageClient from "./MailboxPageClient";

export default async function MailboxPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  const scope = data.user ? await resolveInrcyAccountScopeForUser(supabase, data.user) : null;
  const adsEnabled = Boolean(data.user && scope && await isAdsUserAllowed(data.user.id, scope.activeUserId));
  return <MailboxPageClient adsEnabled={adsEnabled} />;
}
