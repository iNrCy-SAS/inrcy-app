"use client";

import { useId, useState } from "react";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

/** A local preview has an identity without saving it. Only its opaque revision leaves
 * the form; client names, lines and prices remain local to the native renderer. */
export function useInrAssistantDocumentPreview(kind: "quote" | "invoice", savedId: string, snapshot: unknown, pendingChanges = false) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const signature = JSON.stringify(snapshot);
  const [version, setVersion] = useState({ signature, revision: 0 });
  // Adjusting this component's derived state during render prevents committing a
  // frame advertising the old revision with the new form. No effect writes data.
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const selection = { kind, id: savedId || `preview_${instance}` };
  const revision = `preview_${instance}_${version.revision}`;
  useInrAssistantScreen({ selection, revision, availableCommands: ["export_document_pdf"], ...(!savedId || pendingChanges ? { pendingChanges: true } : {}) });
  return { selection, revision };
}
