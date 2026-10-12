// Meta documents creation, publication and deletion, with no native post edit.
// Keep this module pure so history UI and route handlers share one contract.
export const THREADS_EDIT_UNSUPPORTED_MESSAGE = "Meta ne permet pas de modifier une publication Threads déjà publiée via son API. Vous pouvez modifier ses brouillons et supprimer ses publications.";
export const THREADS_PUBLICATION_CAPABILITIES = {
  editDraft: true, editPublished: false, deletePublished: true, retryFailed: true,
  publishedEditMessage: THREADS_EDIT_UNSUPPORTED_MESSAGE,
  documentationUrl: "https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api",
} as const;
