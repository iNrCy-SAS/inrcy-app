/** Physical business location only. Service areas and publication text are not evidence. */
export type BusinessLocation = { postalCode: string; city: string };
export type BusinessLocationSource = { key: string; status: string; content: string; url?: string | null };
export type BusinessLocationCandidate = BusinessLocation & { source: string; priority: number };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const comparable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function jsonValueEnd(value: string, start: number) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') {
      quoted = !quoted;
      if (!quoted && depth === 0) return index + 1;
      continue;
    }
    if (quoted) continue;
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return index;
    }
    if (char === "," && depth === 0) return index;
  }
  return -1;
}

function ownProfilePayload(content: string): Record<string, unknown> {
  try { return record(JSON.parse(content)); } catch { /* A long publication list can truncate the JSON after its intact profile. */ }
  if (!content.startsWith("{")) return {};
  const result: Record<string, unknown> = {};
  const allowed = new Set(["details", "profile", "user", "account", "channel", "organizationName"]);
  let cursor = 1;
  while (cursor < content.length) {
    while (/[\s,]/u.test(content[cursor] || "")) cursor += 1;
    if (content[cursor] !== '"') break;
    const keyEnd = jsonValueEnd(content, cursor);
    if (keyEnd < 0) break;
    let key = "";
    try { key = JSON.parse(content.slice(cursor, keyEnd)); } catch { break; }
    cursor = keyEnd;
    while (/\s/u.test(content[cursor] || "")) cursor += 1;
    if (content[cursor] !== ":") break;
    cursor += 1;
    while (/\s/u.test(content[cursor] || "")) cursor += 1;
    const end = jsonValueEnd(content, cursor);
    if (end < 0) break;
    if (allowed.has(key)) {
      try { result[key] = JSON.parse(content.slice(cursor, end)); } catch { break; }
    }
    cursor = end;
    if (content[cursor] === "}") break;
  }
  return result;
}

export function normalizeBusinessLocation(value: unknown): BusinessLocation {
  const item = record(value);
  return { postalCode: text(item.postalCode), city: text(item.city) };
}

export function validateBusinessLocation(value: unknown): BusinessLocation | null {
  const item = record(value);
  if (typeof item.postalCode !== "string" || typeof item.city !== "string") return null;
  const location = normalizeBusinessLocation(item);
  if (location.postalCode.length > 30 || location.city.length > 120) return null;
  if (/[\u0000-\u001f\u007f<>]/u.test(location.postalCode + location.city)) return null;
  if (location.postalCode && !/^[\p{L}\p{N} .-]+$/u.test(location.postalCode)) return null;
  if (location.city && !/[\p{L}]/u.test(location.city)) return null;
  return location;
}

function candidate(address: unknown, source: string, priority: number): BusinessLocationCandidate | null {
  const item = record(address);
  const location = validateBusinessLocation({
    postalCode: text(item.postalCode) || text(item.postal_code) || text(item.zip),
    city: text(item.addressLocality) || text(item.locality) || text(item.city),
  });
  return location?.postalCode && location.city ? { ...location, source, priority } : null;
}

function fromAddressLine(value: string, source: string, priority: number): BusinessLocationCandidate[] {
  // A free-text fallback deliberately requires a complete French postal/city pair.
  // International locations remain supported through structured postal addresses.
  const found: BusinessLocationCandidate[] = [];
  for (const line of value.split(/[\n\r|;]+/)) {
    const match = line.match(/\b(\d{5})[\s,]+([\p{L}][\p{L}'’ .-]{1,100})/u);
    if (!match) continue;
    const city = match[2].replace(/\s*[,–—].*$/u, "").replace(/\s+France\s*$/iu, "").replace(/\.+$/u, "").trim();
    if (/\b(?:cedex|tel|telephone|horaires|contact|interven\p{L}*|desserv\p{L}*|client|chantier|www|rcs|siret)\b|\s+(?:et|pour|dans|proche|est)\s/iu.test(city)) continue;
    const item = candidate({ postalCode: match[1], city }, source, priority);
    if (item) found.push(item);
  }
  return found;
}

function explicitOwnAddress(value: string, source: string, priority: number) {
  const found: BusinessLocationCandidate[] = [];
  const label = /\b(?:si[eè]ge\s+social|adresse(?:\s+(?:de\s+(?:notre|l['’])?\s*entreprise|du\s+si[eè]ge|de\s+l['’][eé]tablissement))?|nous\s+sommes\s+(?:situ[eé]s?|implant[eé]s?)|notre\s+(?:si[eè]ge|adresse)|registered\s+office|head\s+office|business\s+address)\s*[:\-–—]?/giu;
  for (const match of value.matchAll(label)) {
    const start = (match.index || 0) + match[0].length;
    const block = value.slice(start, start + 280).split(/\n\s*\n|\b(?:t[eé]l[eé]phone|horaires|email|e-mail)\b/iu)[0];
    const context = value.slice(Math.max(0, (match.index || 0) - 100), start) + block;
    if (/\b(?:client|chantier|interven\p{L}*|desserv\p{L}*|partenaire|h[eé]bergeur|hosting|conception\s+du\s+site)\b/iu.test(context)) continue;
    found.push(...fromAddressLine(block, source, priority));
  }
  return found;
}

/** Bounded scan of JSON-LD embedded in already-sanitized website text. */
function embeddedJson(value: string): unknown[] {
  const found: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length && found.length < 40; index += 1) {
    const char = value[index];
    if (start < 0) {
      if (char === "{" || char === "[") { start = index; depth = 1; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    if (depth === 0 || index - start > 16_000) {
      if (depth === 0) {
        try { found.push(JSON.parse(value.slice(start, index + 1))); } catch { /* Truncated site JSON-LD is not evidence. */ }
      }
      start = -1; depth = 0; quoted = false;
    }
  }
  return found;
}

function websiteBusinessIdentities(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(websiteBusinessIdentities);
  const item = record(value);
  const types = (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).map(text);
  const isBusiness = types.some((type) => /^(?:Organization|Corporation|LocalBusiness|ProfessionalService|Store|Restaurant|CafeOrCoffeeShop|BarOrPub|Hotel|LodgingBusiness|MedicalBusiness|Dentist|Physician|LegalService|Attorney|FinancialService|RealEstateAgent|TravelAgency|AutomotiveBusiness|AutoRepair|AutoDealer|HomeAndConstructionBusiness|Electrician|Plumber|RoofingContractor|GeneralContractor|HVACBusiness|Locksmith|HousePainter|MovingCompany|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|SportsActivityLocation|EducationalOrganization|ChildCare|EntertainmentBusiness|FoodEstablishment|ShoppingCenter)$/u.test(type.replace(/^https?:\/\/schema\.org\//u, "")));
  const found = isBusiness ? [item] : [];
  // Only graph members and the publisher of a WebSite are business identities.
  // Never recurse into articles, reviews, customers, serviceArea or events.
  if (Array.isArray(item["@graph"])) found.push(...websiteBusinessIdentities(item["@graph"]));
  if (types.includes("WebSite")) found.push(...websiteBusinessIdentities(item.publisher));
  return found;
}

function ownWebsiteIdentities(source: BusinessLocationSource) {
  const content = source.content.slice(0, 60_000);
  let host = "";
  try { host = new URL(source.url || content.match(/^PAGE\s+(https?:\/\/\S+)/mu)?.[1] || "").hostname.replace(/^www\./u, ""); } catch { /* No trusted website host. */ }
  return embeddedJson(content).flatMap(websiteBusinessIdentities).filter((item) => {
    const url = text(item.url) || text(item["@id"]);
    try { return Boolean(host) && new URL(url).hostname.replace(/^www\./u, "") === host; }
    catch { return false; }
  });
}

function ownWebsiteText(source: BusinessLocationSource) {
  return source.content.slice(0, 60_000).split(/(?=^PAGE\s+https?:\/\/)/mu).filter((page) => {
    const pageUrl = page.match(/^PAGE\s+(https?:\/\/\S+)/mu)?.[1];
    if (!pageUrl) return false;
    try { return !/\/(?:blog|actualites|news|realisations|portfolio|projets|articles|publications?)(?:\/|$)/iu.test(new URL(pageUrl).pathname); }
    catch { return false; }
  }).join("\n\n");
}

function sourceCandidates(source: BusinessLocationSource): BusinessLocationCandidate[] {
  if (source.status !== "analyzed" || !source.content || ["inr_search", "inrcy_publications"].includes(source.key)) return [];
  const content = source.content.slice(0, 60_000);
  const payload = ownProfilePayload(content);
  if (source.key === "google_business") {
    const item = candidate(record(payload.details).address, source.key, 0);
    return item ? [item] : [];
  }
  if (source.key === "facebook") {
    const item = candidate(record(payload.profile).location, source.key, 10);
    if (item) return [item];
  }
  if (source.key === "website") {
    const structured = ownWebsiteIdentities(source).flatMap((item) =>
      (Array.isArray(item.address) ? item.address : [item.address])
        .map((address) => candidate(address, source.key, 20))
        .filter((item): item is BusinessLocationCandidate => Boolean(item)));
    return [...structured, ...explicitOwnAddress(ownWebsiteText(source), source.key, 40)];
  }
  const ownProfiles = [payload.profile, payload.user, payload.account, payload.channel];
  // Some integrations expose their profile directly, without a profile wrapper.
  if (!ownProfiles.some((item) => Object.keys(record(item)).length)) ownProfiles.push(payload);
  return ownProfiles.flatMap((value) => {
    const own = record(value);
    const locations = [own.address, own.location, own.storefrontAddress]
      .map((address) => candidate(address, source.key, 30))
      .filter((item): item is BusinessLocationCandidate => Boolean(item));
    if (typeof own.location === "string") locations.push(...fromAddressLine(own.location, source.key, 35));
    for (const key of ["biography", "description", "about", "bio", "contact", "legalNotice"]) {
      locations.push(...explicitOwnAddress(text(own[key]), source.key, 40));
    }
    return locations;
  });
}

export function resolveBusinessLocationCandidate(sources: BusinessLocationSource[]): BusinessLocationCandidate | null {
  const candidates = sources.flatMap(sourceCandidates).sort((a, b) => a.priority - b.priority);
  if (!candidates.length) return null;
  const best = candidates.filter((item) => item.priority === candidates[0].priority);
  const locations = new Set(best.map((item) => `${comparable(item.postalCode)}:${comparable(item.city)}`));
  // Several equally reliable establishments require a manual choice.
  return locations.size === 1 ? best[0] : null;
}

export function buildMissingBusinessLocationPatch(current: BusinessLocation, proposed: BusinessLocation | null): Partial<BusinessLocation> | null {
  if (!proposed || (current.postalCode && current.city)) return null;
  if (current.city && comparable(current.city) !== comparable(proposed.city)) return null;
  if (current.postalCode && comparable(current.postalCode) !== comparable(proposed.postalCode)) return null;
  return {
    ...(!current.postalCode ? { postalCode: proposed.postalCode } : {}),
    ...(!current.city ? { city: proposed.city } : {}),
  };
}

type BusinessIdentityField = "company_legal_name" | "phone" | "contact_email";
export type BusinessIdentitySuggestion = { value: string; source: string; priority: number };
export type BusinessIdentitySuggestions = Partial<Record<BusinessIdentityField, BusinessIdentitySuggestion>>;

function validBusinessIdentityValue(field: BusinessIdentityField, value: unknown) {
  const item = text(value);
  if (!item || /[\u0000-\u001f\u007f<>]/u.test(item)) return "";
  if (field === "contact_email") return item.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item) ? item.toLowerCase() : "";
  if (field === "phone") return /^[+()\d .-]+$/u.test(item) && item.replace(/\D/gu, "").length >= 7 && item.replace(/\D/gu, "").length <= 15 ? item : "";
  return item.length <= 200 && /\p{L}/u.test(item) && !/^(?:votre entreprise|your business|entreprise|contact|accueil|home)$/iu.test(item) ? item : "";
}

/** Public profile identity/contact fields only; never publications or reviewers. */
export function resolveBusinessIdentitySuggestions(sources: BusinessLocationSource[]): BusinessIdentitySuggestions {
  const candidates: Partial<Record<BusinessIdentityField, BusinessIdentitySuggestion[]>> = {};
  const add = (field: BusinessIdentityField, value: unknown, source: string, priority: number) => {
    const clean = validBusinessIdentityValue(field, value);
    if (clean) (candidates[field] ||= []).push({ value: clean, source, priority });
  };
  for (const source of sources) {
    if (source.status !== "analyzed" || ["inr_search", "inrcy_publications"].includes(source.key)) continue;
    const payload = ownProfilePayload(source.content.slice(0, 60_000));
    if (source.key === "google_business") {
      const details = record(payload.details);
      add("company_legal_name", details.title, source.key, 0);
      add("phone", record(details.phoneNumbers).primaryPhone, source.key, 0);
    } else if (source.key === "facebook") {
      const profile = record(payload.profile);
      add("company_legal_name", profile.name, source.key, 10);
      add("phone", profile.phone, source.key, 10);
      for (const email of Array.isArray(profile.emails) ? profile.emails : []) add("contact_email", email, source.key, 10);
    } else if (source.key === "website") {
      for (const identity of ownWebsiteIdentities(source)) {
        add("company_legal_name", text(identity.legalName) || identity.name, source.key, 20);
        add("phone", identity.telephone, source.key, 20);
        add("contact_email", identity.email, source.key, 20);
      }
      const ownText = ownWebsiteText(source).split(/\b(?:h[eé]bergeur|h[eé]bergement\s+du\s+site|hosting\s+provider|conception\s+du\s+site)\b/iu)[0];
      const legalName = ownText.match(/\b(?:raison\s+sociale|d[eé]nomination\s+sociale|nom\s+de\s+l['’]entreprise)\s*:\s*([^\n\r|;]{2,200})/iu)?.[1];
      add("company_legal_name", legalName, source.key, 40);
      for (const match of ownText.matchAll(/\b(?:e-?mail|courriel|contact)\s*:\s*([^\s@]+@[^\s@]+\.[^\s@,;]+)/giu)) {
        add("contact_email", match[1], source.key, 40);
      }
      for (const match of ownText.matchAll(/\b(?:t[eé]l(?:[eé]phone)?|phone)\s*[:.]\s*([+()\d .-]{7,30})/giu)) {
        add("phone", match[1], source.key, 40);
      }
    } else {
      add("company_legal_name", payload.organizationName, source.key, 30);
    }
    // A coordinate explicitly stored on the channel's own public profile is
    // trustworthy, unlike a phone/email occurring in one of its publications.
    for (const value of [payload.profile, payload.user, payload.account, payload.channel]) {
      const own = record(value);
      add("phone", own.phone, source.key, 30);
      add("phone", own.telephone, source.key, 30);
      add("contact_email", own.email, source.key, 30);
      for (const key of ["biography", "description", "about", "bio"]) {
        const description = text(own[key]);
        const phone = description.match(/\b(?:t[eé]l(?:[eé]phone)?|phone)\s*[:.]\s*([+()\d .-]{7,30})/iu)?.[1];
        const email = description.match(/\b(?:e-?mail|courriel|contact)\s*:\s*([^\s@]+@[^\s@]+\.[^\s@,;]+)/iu)?.[1];
        add("phone", phone, source.key, 40);
        add("contact_email", email, source.key, 40);
      }
    }
  }
  const result: BusinessIdentitySuggestions = {};
  for (const field of ["company_legal_name", "phone", "contact_email"] as const) {
    const values = (candidates[field] || []).sort((a, b) => a.priority - b.priority);
    if (!values.length) continue;
    const best = values.filter((item) => item.priority === values[0].priority);
    const unique = new Set(best.map((item) => field === "phone" ? item.value.replace(/\D/gu, "") : comparable(item.value)));
    if (unique.size === 1) result[field] = best[0];
  }
  return result;
}
