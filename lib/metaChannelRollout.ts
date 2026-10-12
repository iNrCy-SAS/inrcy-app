/** Open these channels to USER accounts only after Meta App Review is approved. */
export const META_DIRECT_CHANNELS_PUBLIC_ENABLED = false;

export function isMetaChannelPilotEnabled(isAdmin: boolean): boolean {
  return META_DIRECT_CHANNELS_PUBLIC_ENABLED || isAdmin === true;
}
