import { createSupabaseServer } from "@/lib/supabaseServer";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import MailboxPageClient from "./MailboxPageClient";

export default async function MailboxPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  const adsEnabled = Boolean(data.user && await isAdsPilotAdmin(data.user.id));
  return <MailboxPageClient adsEnabled={adsEnabled} />;
}
