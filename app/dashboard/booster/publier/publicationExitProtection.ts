/** An unfinished publication remains a workspace even after its draft is saved. */
export function shouldProtectPublicationExit(state: {
  completed: boolean;
  creationMode: string | null;
  hasContent: boolean;
  hasLocalDocuments: boolean;
  channelsCustomized: boolean;
  busy: boolean;
}) {
  return !state.completed && Boolean(
    state.creationMode || state.hasContent || state.hasLocalDocuments ||
    state.channelsCustomized || state.busy,
  );
}
