import "server-only";

import {
  pausePinterestAdsCampaign as pausePinterestAdsCampaignCore,
  PinterestAdsLifecycleError,
  readPinterestAdsCampaignState as readPinterestAdsCampaignStateCore,
  resumePinterestAdsCampaign as resumePinterestAdsCampaignCore,
  type PinterestAdsLifecycleResult,
} from "./adsPinterestLifecycleCore.ts";
import { pinterestAdsAccessToken } from "./adsPinterestServer.ts";

export { PinterestAdsLifecycleError };

const PINTEREST_API_BASE_URL = "https://api.pinterest.com/v5";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerMessage(value: unknown, status: number): string {
  const payload = record(value);
  const direct = [payload.message, payload.error_description, payload.error]
    .find((entry) => typeof entry === "string" && entry.trim());
  return typeof direct === "string" ? direct.trim() : `Pinterest Ads a refusé l’action (${status}).`;
}

async function pinterestLifecycleRequest(
  accessToken: string,
  path: string,
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${PINTEREST_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Pinterest Ads n’a pas confirmé l’action. Vérifiez Ads Manager avant de réessayer.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(providerMessage(payload, response.status));
  return payload;
}

async function requestFor(userId: string) {
  const accessToken = await pinterestAdsAccessToken(userId);
  return (path: string, method: "GET" | "PATCH", body?: unknown) =>
    pinterestLifecycleRequest(accessToken, path, method, body);
}

export async function readPinterestAdsCampaignState(
  userId: string,
  input: { adAccountId: string; resources: unknown },
): Promise<PinterestAdsLifecycleResult> {
  return readPinterestAdsCampaignStateCore(input.adAccountId, input.resources, await requestFor(userId));
}

export async function setPinterestAdsCampaignPaused(
  userId: string,
  input: { adAccountId: string; resources: unknown; paused: boolean },
): Promise<PinterestAdsLifecycleResult> {
  const request = await requestFor(userId);
  return input.paused
    ? pausePinterestAdsCampaignCore(input.adAccountId, input.resources, request)
    : resumePinterestAdsCampaignCore(input.adAccountId, input.resources, request);
}
