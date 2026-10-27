/** Meta App Review approved: Instagram direct and Threads are available to all accounts. */
export const META_DIRECT_CHANNELS_PUBLIC_ENABLED = true;

/** The reviewer flag must come from the approved identity/account predicate. */
export function isMetaChannelPilotEnabled(isAdmin: boolean, isApprovedReviewer = false): boolean {
  return META_DIRECT_CHANNELS_PUBLIC_ENABLED || isAdmin === true || isApprovedReviewer === true;
}
