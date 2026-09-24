/** A first, predictable Meta format: a single image in both Facebook and Instagram feeds. */
export function metaFeedTargeting() {
  return {
    age_min: 18,
    geo_locations: { countries: ["FR"] },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed"],
    instagram_positions: ["stream"],
  };
}

export function metaLinkCreativeStory(input: {
  pageId: string;
  instagramUserId: string;
  destinationUrl: string;
  primaryText: string;
  imageUrl: string;
}) {
  return {
    page_id: input.pageId,
    instagram_user_id: input.instagramUserId,
    link_data: {
      link: input.destinationUrl,
      message: input.primaryText,
      picture: input.imageUrl,
      call_to_action: { type: "LEARN_MORE" },
    },
  };
}
