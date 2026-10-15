/** Storage checkpoints are server inputs, never downloadable application assets. */
export function isInternalStorageReference(bucket: string, storagePath: string) {
  if (String(bucket).trim().toLowerCase() === "inrcy-ai-composition") return true;
  let path = String(storagePath).replace(/\\/g, "/");
  for (let pass = 0; pass < 4; pass++) {
    if (path.toLowerCase().split("/").includes("_composition-recovery")) return true;
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded.replace(/\\/g, "/");
    } catch { break; }
  }
  return false;
}

export function normalizeStorageDeliveryPath(value: string) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  // Encoded separators/traversal must not change the account prefix downstream.
  if (!path || path.includes("..") || /[\\\u0000-\u001f\u007f]/.test(path) || /%(?:2f|5c|2e|25)/i.test(path)) return "";
  return path;
}

const ACCOUNT_ASSET_BUCKETS = new Set(["booster", "inrbox_attachments", "inr-agent-reports", "logos"]);
export const ATTACHMENT_DOWNLOAD_BUCKETS = new Set(["booster", "inrbox_attachments", "inr-agent-reports", "inrcy-pro-media"]);

/** Use only with a server-selected account, never an account from the request body. */
export function canAccountUseStorageReference(bucket: string, storagePath: string, accountId: string) {
  const cleanBucket = String(bucket || "").trim();
  const path = normalizeStorageDeliveryPath(storagePath);
  if (!path || !/^[a-z0-9_-]+$/i.test(accountId) || isInternalStorageReference(cleanBucket, path)) return false;
  if (cleanBucket === "inrcy-image-bank") return true;
  if (cleanBucket === "inrcy-pro-media") return path.startsWith(`users/${accountId}/`);
  return ACCOUNT_ASSET_BUCKETS.has(cleanBucket) && path.startsWith(`${accountId}/`);
}
