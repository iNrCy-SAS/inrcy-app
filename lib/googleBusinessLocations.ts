export type GoogleBusinessAccount = { name: string; accountName?: string; type?: string };
export type GoogleBusinessLocation = {
  name: string;
  title?: string;
  accountName: string;
  accountLabel?: string;
  addressLabel?: string;
  status: "OPEN" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "UNKNOWN";
  mapsUri?: string;
};

type Fetcher = typeof fetch;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

export class GoogleBusinessReadError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function read(url: URL, token: string, fetcher: Fetcher) {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const data = object(await response.json().catch(() => ({})));
  if (!response.ok) throw new GoogleBusinessReadError(response.status, text(object(data.error).message) || `Google Business (${response.status})`);
  return data;
}

/** Read every page; a repeated token must not silently produce an incomplete list. */
async function pages(url: URL, token: string, key: string, fetcher: Fetcher) {
  const rows: RecordValue[] = [];
  const seen = new Set<string>();
  for (;;) {
    const data = await read(url, token, fetcher);
    if (Array.isArray(data[key])) rows.push(...data[key].map(object));
    const next = text(data.nextPageToken);
    if (!next) return rows;
    if (seen.has(next)) throw new Error("La liste Google Business n’a pas pu être chargée entièrement. Réessayez.");
    seen.add(next);
    url.searchParams.set("pageToken", next);
  }
}

export async function listAllGoogleBusinessAccounts(token: string, fetcher: Fetcher = fetch): Promise<GoogleBusinessAccount[]> {
  const url = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  url.searchParams.set("pageSize", "20");
  return (await pages(url, token, "accounts", fetcher)).map(row => ({ name: text(row.name), accountName: text(row.accountName), type: text(row.type) })).filter(row => /^accounts\/[a-zA-Z0-9_-]+$/.test(row.name));
}

function summary(row: RecordValue, accountName: string, legacy = false): GoogleBusinessLocation {
  const address = object(row.storefrontAddress || row.address);
  const openInfo = object(row.openInfo);
  const metadata = object(row.metadata);
  const status = text(openInfo.status);
  const resource = text(row.name);
  const locationId = /(?:^|\/)locations\/([a-zA-Z0-9_-]+)$/.exec(resource)?.[1];
  return {
    name: locationId ? `locations/${locationId}` : "",
    title: text(legacy ? row.locationName : row.title),
    accountName,
    addressLabel: [...(Array.isArray(address.addressLines) ? address.addressLines.map(text) : []), text(address.postalCode), text(address.locality)].filter(Boolean).join(" · "),
    status: status === "OPEN" || status === "CLOSED_TEMPORARILY" || status === "CLOSED_PERMANENTLY" ? status : "UNKNOWN",
    mapsUri: text(metadata.mapsUri) || text(metadata.mapsUrl),
  };
}

export async function listAllGoogleBusinessLocations(token: string, accountName: string, fetcher: Fetcher = fetch): Promise<GoogleBusinessLocation[]> {
  if (!/^accounts\/[a-zA-Z0-9_-]+$/.test(accountName)) throw new Error("Compte Google Business invalide.");
  const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`);
  url.searchParams.set("readMask", "name,title,storefrontAddress,openInfo,metadata");
  url.searchParams.set("pageSize", "100");
  try {
    return (await pages(url, token, "locations", fetcher)).map(row => summary(row, accountName)).filter(row => row.name);
  } catch (error) {
    // Preserve discovery on older Google projects without hiding the loss of status.
    if (error instanceof GoogleBusinessReadError && error.status === 400 && /read.?mask|invalid.*field|field.*invalid/i.test(error.message)) {
      url.searchParams.delete("pageToken");
      url.searchParams.set("readMask", "name,title");
      return (await pages(url, token, "locations", fetcher)).map(row => summary(row, accountName)).filter(row => row.name);
    }
    if (!/Access Not Configured|accessNotConfigured|has not been used|API.*not enabled/i.test(String(error))) throw error;
    const legacyUrl = new URL(`https://mybusiness.googleapis.com/v4/${accountName}/locations`);
    legacyUrl.searchParams.set("pageSize", "100");
    return (await pages(legacyUrl, token, "locations", fetcher)).map(row => summary(row, accountName, true)).filter(row => row.name);
  }
}

export async function discoverGoogleBusinessLocations(token: string, preferredAccount?: string | null, fetcher: Fetcher = fetch) {
  const accounts = await listAllGoogleBusinessAccounts(token, fetcher);
  const locations = new Map<string, GoogleBusinessLocation>();
  const errors: Array<{ accountName: string }> = [];
  // Prefer the saved parent only when deduplicating the same establishment.
  const ordered = [...accounts].sort((a, b) => Number(b.name === preferredAccount) - Number(a.name === preferredAccount));
  for (let offset = 0; offset < ordered.length; offset += 3) {
    const group = ordered.slice(offset, offset + 3);
    const results = await Promise.allSettled(group.map(account => listAllGoogleBusinessLocations(token, account.name, fetcher)));
    results.forEach((result, index) => {
      const account = group[index];
      if (result.status === "rejected") { errors.push({ accountName: account.name }); return; }
      for (const location of result.value) if (!locations.has(location.name)) locations.set(location.name, { ...location, accountLabel: account.accountName || account.name });
    });
  }
  return { accounts, locations: [...locations.values()], complete: errors.length === 0, errors };
}
