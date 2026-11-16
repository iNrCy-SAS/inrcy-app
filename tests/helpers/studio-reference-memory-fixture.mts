import * as memory from "../../lib/studioReferenceMemoryClient.ts";

/** Existing Studio tests exercise the real pure contract and mock only account IO. */
export const studioReferenceMemoryFixture = { ...memory,
  requestStudioReferenceMemory: async (method: string, scope: { accountId: string }) => {
    if (method !== "GET") throw new Error("This fixture never writes remembered media");
    return { ok: true, accountId: scope.accountId, memory: null, media: [], unavailableMediaIds: [] };
  },
};
export const studioReferenceLibraryUploadFixture = {
  uploadFileToMediaLibrary: async () => { throw new Error("This fixture never uploads remembered media"); },
};
