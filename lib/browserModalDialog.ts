export function findOpenBrowserModal(document: Document): HTMLDialogElement | null {
  try {
    return document.querySelector<HTMLDialogElement>("dialog:modal");
  } catch {
    // Dialogs opened with show() explicitly identify themselves as non-modal.
    return document.querySelector<HTMLDialogElement>('dialog[open]:not([aria-modal="false"])');
  }
}
