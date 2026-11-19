import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getDirectSignupMetadata, isDirectSignupPaid } from "@/lib/directSignupPolicy";
import { loadOrRepairDirectSignupSubscription } from "@/lib/directSignupServer";
import { getTemporaryPasswordMetadata } from "@/lib/temporaryPasswordPolicy";
import TemporaryPasswordWelcomeGate from "@/app/dashboard/_components/TemporaryPasswordWelcomeGate";
import DirectSignupPlans from "./DirectSignupPlans";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Votre abonnement iNrCy", robots: { index: false, follow: false } };

/** This authenticated purchase area mounts no dashboard or assistant before payment. */
export default async function ActivateAccountPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) redirect("/login");
  if (!getDirectSignupMetadata(user.app_metadata)) redirect("/dashboard");
  const subscription = await loadOrRepairDirectSignupSubscription(user);
  if (isDirectSignupPaid(subscription)) redirect("/dashboard");
  const params = await searchParams;
  const checkout = params?.checkout === "success" || params?.checkout === "cancel" ? params.checkout : null;
  return <TemporaryPasswordWelcomeGate actorUserId={user.id} temporaryPasswordWelcomeId={getTemporaryPasswordMetadata(user.app_metadata)?.welcome_id ?? null} email={user.email ?? ""}>
    <DirectSignupPlans email={user.email ?? ""} checkout={checkout} />
  </TemporaryPasswordWelcomeGate>;
}
