import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY } from "@/lib/signupRecoveryProof";

/** Auth app_metadata is server-writable; user_metadata is not a durable claim. */
export async function markPublicSignupTrialCompleted(userId: string) {
  const { data: existing, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (lookupError) throw lookupError;
  if (!existing.user) throw new Error("signup_trial_completion_user_missing");

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...existing.user.app_metadata,
      [SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY]: new Date().toISOString(),
    },
  });
  if (error) throw error;
  if (!data.user?.app_metadata?.[SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY]) {
    throw new Error("signup_trial_completion_marker_missing");
  }
}
