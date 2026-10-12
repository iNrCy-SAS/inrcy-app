export const THREADS_GRAPH_API_VERSION = "v1.0";
export const THREADS_GRAPH_API_BASE_URL = `https://graph.threads.com/${THREADS_GRAPH_API_VERSION}`;

export function buildThreadsGraphUrl(path: unknown) {
  const normalizedPath = String(path || "").trim().replace(/^\/+/, "");
  return normalizedPath ? `${THREADS_GRAPH_API_BASE_URL}/${normalizedPath}` : THREADS_GRAPH_API_BASE_URL;
}

export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_delete"] as const;
