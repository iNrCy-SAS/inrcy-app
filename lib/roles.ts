import "server-only";

import { createSupabaseServer } from "@/lib/supabaseServer";

// ✅ iNrCy: comptes admin autorisés à voir la zone Admin iNrCy.
// Staff reste un rôle possible pour plus tard, mais les pages / API admin sont verrouillées admin-only.
export const ADMIN_USER_IDS = ["670b527d-5e08-42b4-ba95-e58e812339eb"] as const;

export type AppRole = "user" | "staff" | "admin" | "reviewer";

export function isAdminRole(role: string | null | undefined): role is "admin" {
  return role === "admin";
}

export function isStaffRole(role: string | null | undefined): role is "staff" | "admin" {
  return role === "staff" || role === "admin";
}

/** Reviewers can exercise product tools without receiving staff or admin privileges. */
export function isReviewerRole(role: unknown): role is "reviewer" {
  return role === "reviewer";
}

export async function getMyRole(): Promise<{ role: AppRole | null; isStaff: boolean; isAdmin: boolean; isReviewer: boolean; authUserId: string | null }> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { role: null, isStaff: false, isAdmin: false, isReviewer: false, authUserId: null };

  // Hard allow-list for your main admin account (useful even if role column isn't deployed yet)
  if (ADMIN_USER_IDS.includes(user.id as any)) {
    return { role: "admin", isStaff: true, isAdmin: true, isReviewer: false, authUserId: user.id };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return { role: null, isStaff: false, isAdmin: false, isReviewer: false, authUserId: user.id };
  const storedRole = profile?.role;
  const role: AppRole | null = ["user", "staff", "admin", "reviewer"].includes(storedRole) ? storedRole as AppRole : null;
  return { role, isStaff: isStaffRole(role), isAdmin: isAdminRole(role), isReviewer: isReviewerRole(role), authUserId: user.id };
}
