/** Verify the complete object, not only the browser's declared upload size. */
export async function verifyMediaLibraryStoredUpload(params: {
  storage: { from: (bucket: string) => { list: (folder: string, options: { limit: number; search: string }) => PromiseLike<{ data: unknown; error: unknown }> } };
  bucket: string;
  storagePath: string;
  expectedSize: number;
  wait?: (ms: number) => Promise<void>;
}) {
  const segments = params.storagePath.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name || !Number.isSafeInteger(params.expectedSize) || params.expectedSize <= 0) return false;
  const wait = params.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown = null;
  for (const delay of [0, 250, 650, 1200]) {
    if (delay) await wait(delay);
    const result = await params.storage.from(params.bucket).list(segments.join("/"), { limit: 20, search: name });
    if (result.error) { lastError = result.error; continue; }
    const rows = Array.isArray(result.data) ? result.data : [];
    const stored = rows.find((row) => row?.name === name);
    const size = Number(stored?.metadata?.size ?? stored?.metadata?.contentLength ?? stored?.metadata?.content_length ?? stored?.size ?? 0);
    if (stored && size === params.expectedSize) return true;
  }
  if (lastError) throw lastError;
  return false;
}
