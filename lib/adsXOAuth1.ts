import crypto from "node:crypto";

/** RFC 3986 percent encoding as required by OAuth 1.0a (encodeURIComponent alone is insufficient). */
export function xAdsPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signXAdsOAuthRequest(input: {
  method: "GET" | "POST";
  url: string;
  apiKey: string;
  apiSecret: string;
  token?: string;
  tokenSecret?: string;
  oauth?: Record<string, string>;
  /** Form-encoded POST fields, when present, participate in the OAuth base string. */
  formParams?: URLSearchParams;
  nonce?: string;
  timestamp?: string;
}) {
  const url = new URL(input.url);
  if (url.protocol !== "https:") throw new Error("X Ads requires HTTPS");
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.apiKey,
    oauth_nonce: input.nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(input.token ? { oauth_token: input.token } : {}),
    ...input.oauth,
  };
  const encodedOrder = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const parameters = [...url.searchParams.entries(), ...Object.entries(oauth), ...(input.formParams?.entries() || [])]
    .filter(([key]) => key !== "oauth_signature")
    .map(([key, value]) => [xAdsPercentEncode(key), xAdsPercentEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => encodedOrder(leftKey, rightKey) || encodedOrder(leftValue, rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = `${input.method}&${xAdsPercentEncode(baseUrl)}&${xAdsPercentEncode(parameters)}`;
  const signingKey = `${xAdsPercentEncode(input.apiSecret)}&${xAdsPercentEncode(input.tokenSecret || "")}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  const authorization = `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .sort(([left], [right]) => encodedOrder(left, right))
    .map(([key, value]) => `${xAdsPercentEncode(key)}="${xAdsPercentEncode(value)}"`)
    .join(", ")}`;
  return { authorization, signature, baseString };
}
