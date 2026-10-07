// Cette case est locale à l'interface : elle ne devient jamais une action enregistrée.
export const INSTANT_PUBLICATION_PREPARATION_ID = "inragent-instant-publication-preparation";

export type PublicationViewerItem<T> = {
  id: string;
  action: T | null;
};

export function buildPublicationViewerItems<T extends { id: string }>(
  actions: T[],
  selectedAction: T | null,
  preparationInProgress: boolean,
): PublicationViewerItem<T>[] {
  const visibleActions = selectedAction && !actions.some((action) => action.id === selectedAction.id)
    ? [selectedAction, ...actions]
    : actions;
  const items = visibleActions.map((action) => ({ id: action.id, action }));
  return preparationInProgress
    ? [{ id: INSTANT_PUBLICATION_PREPARATION_ID, action: null }, ...items]
    : items;
}

export function nextPublicationViewerId(
  items: { id: string }[],
  selectedId: string | null,
  offset: number,
): string | null {
  if (items.length < 2) return null;
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const index = Math.max(0, selectedIndex);
  const nextIndex = ((index + offset) % items.length + items.length) % items.length;
  return items[nextIndex].id;
}
