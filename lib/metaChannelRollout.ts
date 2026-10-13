/** Open these channels to USER accounts only after Meta App Review is approved. */
export const META_DIRECT_CHANNELS_PUBLIC_ENABLED = false;

/** The reviewer flag must come from the approved identity/account predicate. */
export function isMetaChannelPilotEnabled(isAdmin: boolean, isApprovedReviewer = false): boolean {
  return META_DIRECT_CHANNELS_PUBLIC_ENABLED || isAdmin === true || isApprovedReviewer === true;
}
