function unique(values: readonly string[]) {
  return values.filter(
    (value, index, entries) => Boolean(value) && entries.indexOf(value) === index,
  );
}

/**
 * Keeps every explicit per-channel selection stable when the global image pool
 * changes. A newly added physical source remains unassigned until the user
 * chooses it for a channel.
 */
export function mergeBoosterChannelImageSelection(params: {
  availableKeys: readonly string[];
  previousSelectedKeys?: readonly string[];
  previousAvailableKeys?: readonly string[];
  supportsImages: boolean;
}) {
  if (!params.supportsImages) return [];
  const available = unique(params.availableKeys);
  const previousAvailable = Array.isArray(params.previousAvailableKeys)
    ? unique(params.previousAvailableKeys)
    : null;
  const retained = unique(params.previousSelectedKeys || []).filter((key) =>
    available.includes(key),
  );

  // A restored draft can carry an ordered subset without the transient
  // synchronization marker. Preserve that explicit mapping. Only a genuinely
  // new channel (no selected-key field at all) starts with the complete pool.
  if (previousAvailable === null) {
    return Array.isArray(params.previousSelectedKeys) ? retained : available;
  }

  return retained;
}

/**
 * A global "add images" action extends channels that were still using the
 * complete previous pool. Explicit subsets and empty (disabled) channels stay
 * untouched, so independent per-channel choices remain authoritative.
 */
export function extendBoosterChannelImageSelectionForGlobalAdd(params: {
  previousAvailableKeys: readonly string[];
  previousSelectedKeys?: readonly string[];
  newKeys: readonly string[];
  supportsImages: boolean;
  maxImages?: number;
}) {
  if (!params.supportsImages) return [];
  const maxImages = Math.max(1, Math.floor(Number(params.maxImages) || 5));
  const previousAvailable = unique(params.previousAvailableKeys).slice(0, maxImages);
  const previousSelected = Array.isArray(params.previousSelectedKeys)
    ? unique(params.previousSelectedKeys).filter((key) =>
        previousAvailable.includes(key),
      )
    : previousAvailable;
  const usedCompletePreviousPool =
    previousSelected.length === previousAvailable.length &&
    previousAvailable.every((key) => previousSelected.includes(key));

  if (!usedCompletePreviousPool) return previousSelected.slice(0, maxImages);
  return unique([...previousSelected, ...params.newKeys]).slice(0, maxImages);
}
