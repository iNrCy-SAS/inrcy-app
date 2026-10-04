type StoredAttribution = { user_id: string; event_id: string };

export type SignupAttributionStore = {
  findByUserId(userId: string): Promise<StoredAttribution | null>;
  findByEventId(eventId: string): Promise<StoredAttribution | null>;
  insertIfAbsent(eventId: string): Promise<StoredAttribution | null>;
};

function isEventIdConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23505" && typeof message === "string" &&
    /\b(signup_attributions_event_id_unique|meta_conversion_events_event_id_key)\b/.test(message);
}

/** Keep the first attribution and its delivery status, including concurrent retries. */
export async function persistSignupAttributionOnce(
  input: { userId: string; eventId: string },
  store: SignupAttributionStore,
) {
  const fallbackEventId = `inrcy-lead-${input.userId}`;
  const existing = await store.findByUserId(input.userId);
  if (existing) return { eventId: existing.event_id || fallbackEventId };

  const requestedEventId = input.eventId || fallbackEventId;
  const owner = await store.findByEventId(requestedEventId);
  let eventId = owner && owner.user_id !== input.userId ? fallbackEventId : requestedEventId;
  let inserted: StoredAttribution | null;
  try {
    inserted = await store.insertIfAbsent(eventId);
  } catch (error) {
    // Another signup may claim the browser event between lookup and insert.
    // Never resolve this conflict by moving another user's attribution.
    if (!isEventIdConflict(error) || eventId === fallbackEventId) throw error;
    eventId = fallbackEventId;
    inserted = await store.insertIfAbsent(eventId);
  }

  // ON CONFLICT(user_id) DO NOTHING can mean a concurrent request won.
  const persisted = inserted || await store.findByUserId(input.userId);
  if (!persisted) throw new Error("signup_attribution_persistence_missing");
  return { eventId: persisted.event_id || fallbackEventId };
}
