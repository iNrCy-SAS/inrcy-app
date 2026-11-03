/** Explicit link intents. Google Business exposes these as native buttons;
 * other publishing integrations include the label and URL in the post. */
export const BOOSTER_LINK_CTA_ACTIONS = {
  reserver: "BOOK",
  commander: "ORDER",
  acheter: "SHOP",
  inscrire: "SIGN_UP",
} as const;

export type BoosterLinkCtaChoice = keyof typeof BOOSTER_LINK_CTA_ACTIONS;
export type BoosterLinkCtaAction = (typeof BOOSTER_LINK_CTA_ACTIONS)[BoosterLinkCtaChoice];

export function isBoosterLinkCtaChoice(value: unknown): value is BoosterLinkCtaChoice {
  return typeof value === "string" && Object.hasOwn(BOOSTER_LINK_CTA_ACTIONS, value);
}

export function getBoosterLinkCtaAction(value: unknown): BoosterLinkCtaAction | "" {
  return isBoosterLinkCtaChoice(value) ? BOOSTER_LINK_CTA_ACTIONS[value] : "";
}

export function getBoosterLinkCtaChoice(action: unknown): BoosterLinkCtaChoice | null {
  return (Object.keys(BOOSTER_LINK_CTA_ACTIONS) as BoosterLinkCtaChoice[])
    .find((choice) => BOOSTER_LINK_CTA_ACTIONS[choice] === action) || null;
}
