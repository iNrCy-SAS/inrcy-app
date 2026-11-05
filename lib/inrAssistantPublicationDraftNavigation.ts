export type InrAssistantPublicationDraftNavigation = { destination: 'booster'; href: string; label: string; publicationDraftId: string };
/** A route constructor, not ownership or permission. The native reader and
 * Booster endpoint independently verify this draft belongs to the account. */
export function getInrAssistantPublicationDraftNavigation(draftId: unknown): InrAssistantPublicationDraftNavigation | null {
  if (typeof draftId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(draftId)) return null;
  const id = draftId.toLowerCase();
  return { destination: 'booster', href: `/dashboard?action=publish&draftId=${id}`, label: 'Reprendre le brouillon de publication', publicationDraftId: id };
}
