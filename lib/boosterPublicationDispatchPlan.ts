export type BoosterChannelPreflightFailure = Record<string, unknown> & {
  ok: false;
  code: string;
  error: string;
};

// Unicode matching treats a valid surrogate pair as one character.
const INVALID_PUBLICATION_JSON_TEXT = /[\u0000\uD800-\uDFFF]/u;

export function hasInvalidBoosterPublicationJson(value: unknown): boolean {
  if (typeof value === "string") return INVALID_PUBLICATION_JSON_TEXT.test(value);
  if (Array.isArray(value)) return value.some(hasInvalidBoosterPublicationJson);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) => INVALID_PUBLICATION_JSON_TEXT.test(key) || hasInvalidBoosterPublicationJson(entry),
  );
}

export function buildBoosterPublicationDispatchPlan<Channel extends string>(
  channels: readonly Channel[],
  failures: Partial<Record<Channel, BoosterChannelPreflightFailure>>,
) {
  const entries = channels.map((channel) => {
    const failure = failures[channel] || null;
    return {
      channel,
      dispatchable: !failure,
      status: failure ? ("failed" as const) : ("queued" as const),
      result: failure,
    };
  });
  return {
    entries,
    dispatchableChannels: entries
      .filter((entry) => entry.dispatchable)
      .map((entry) => entry.channel),
    failedChannels: entries
      .filter((entry) => !entry.dispatchable)
      .map((entry) => entry.channel),
  };
}
