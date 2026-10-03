type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {};
}

/** Proof that this *same action* had already persisted content for this idea. */
export function wasInrAgentPublicationIdeaPreviouslyGenerated(args: {
  payload: unknown;
  metadata: unknown;
  ideaText: string;
}) {
  const payload = record(args.payload);
  const metadata = record(args.metadata);
  if (metadata.editorialPreviouslyGeneratedIdea === args.ideaText) return true;

  const directFocus = record(payload.editorialFocus);
  const focus = typeof directFocus.subject === "string" && directFocus.subject.trim()
    ? directFocus : record(record(payload.editorialPlan).focus);
  if (focus.source !== "professional_idea" || focus.subject !== args.ideaText) return false;
  const directPosts = record(payload.postByChannel);
  const posts = Object.keys(directPosts).length
    ? directPosts : record(record(payload.publishPayload).postByChannel);
  return Object.values(posts).some((post) => {
    const content = record(post);
    return [content.title, content.content, content.cta]
      .some((value) => typeof value === "string" && value.trim().length > 0);
  });
}
