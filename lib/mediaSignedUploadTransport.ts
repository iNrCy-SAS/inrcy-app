type SignedStorageUpload = {
  supabaseUrl: string;
  publicApiKey: string;
  bucket: string;
  storagePath: string;
  token: string;
  contentType: string;
  file: File;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** The server-issued token authorizes this object; no browser Auth lock is needed. */
export async function uploadSignedStorageObject(params: SignedStorageUpload) {
  params.signal?.throwIfAborted();
  const objectPath = [params.bucket, ...params.storagePath.split("/")]
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(
    `${params.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${objectPath}`,
  );
  url.searchParams.set("token", params.token);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs ?? 120_000);

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        apikey: params.publicApiKey,
        "content-type": params.contentType || "application/octet-stream",
        "cache-control": "max-age=3600",
        "x-upsert": "true",
      },
      body: params.file,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const message =
        typeof detail?.message === "string"
          ? detail.message
          : typeof detail?.error === "string"
            ? detail.error
            : `Envoi du média refusé (${response.status}).`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    // Consume the response before releasing the request's cancellation budget.
    await response.arrayBuffer();
  } catch (error) {
    if (params.signal?.aborted) throw params.signal.reason;
    if (timedOut) {
      throw Object.assign(
        new Error("La connexion d’envoi a expiré. Reprise automatique en cours."),
        { status: 408 },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", abortFromCaller);
  }
}
