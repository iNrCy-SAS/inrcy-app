export type InrAgentPinterestBoardSelection = {
  boardId: string;
  boardName: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeInrAgentPinterestBoardSelection(
  value: unknown,
): InrAgentPinterestBoardSelection | null {
  const record = asRecord(value);
  const boardId = clean(record.boardId ?? record.board_id, 240);
  if (!boardId) return null;
  return {
    boardId,
    boardName: clean(record.boardName ?? record.board_name, 240),
  };
}

export function readInrAgentPinterestBoardSelection(
  payload: unknown,
): InrAgentPinterestBoardSelection | null {
  const root = asRecord(payload);
  const publishPayload = asRecord(root.publishPayload);
  return normalizeInrAgentPinterestBoardSelection(
    root.pinterestPublicationSettings ??
      publishPayload.pinterestPublicationSettings,
  );
}

export function applyInrAgentPinterestBoardSelection(
  payload: JsonRecord,
  value: unknown,
): JsonRecord {
  const selection = normalizeInrAgentPinterestBoardSelection(value);
  const nextPayload = { ...payload };
  const nextPublishPayload = { ...asRecord(payload.publishPayload) };

  if (selection) {
    nextPayload.pinterestPublicationSettings = selection;
    nextPublishPayload.pinterestPublicationSettings = selection;
  } else {
    delete nextPayload.pinterestPublicationSettings;
    delete nextPublishPayload.pinterestPublicationSettings;
  }

  nextPayload.publishPayload = nextPublishPayload;
  return nextPayload;
}
