export type Ga4WebPropertyCandidate = {
  propertyId: string;
  measurementId?: string;
  defaultUri?: string;
  displayName?: string;
};

export type Ga4SelectionResolution =
  | "exact_domain"
  | "related_domain"
  | "single_accessible_property";

export type Ga4SelectionResult =
  | {
      ok: true;
      candidate: Ga4WebPropertyCandidate;
      resolution: Ga4SelectionResolution;
      accessiblePropertyCount: number;
      matchingPropertyCount: number;
    }
  | {
      ok: false;
      reason: string;
      accessiblePropertyCount: number;
      matchingPropertyCount: number;
    };

function normalizeComparableDomain(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  try {
    const input = /^(https?:\/\/)/i.test(value) ? value : `https://${value}`;
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

function domainsLooselyMatch(left: string, right: string) {
  const a = normalizeComparableDomain(left);
  const b = normalizeComparableDomain(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function mergeCandidate(
  current: Ga4WebPropertyCandidate | undefined,
  incoming: Ga4WebPropertyCandidate,
): Ga4WebPropertyCandidate {
  if (!current) return incoming;
  const mergeUnique = (left?: string, right?: string) => {
    if (!left) return right;
    if (!right) return left;
    return left === right ? left : undefined;
  };
  return {
    propertyId: current.propertyId,
    // A GA4 property can expose several Web streams. Keep a stream-specific
    // value only when it is unambiguous; the property id remains sufficient
    // for Analytics reporting if several streams differ.
    measurementId: mergeUnique(current.measurementId, incoming.measurementId),
    defaultUri: mergeUnique(current.defaultUri, incoming.defaultUri),
    displayName: current.displayName || incoming.displayName,
  };
}

function uniqueByProperty(candidates: Ga4WebPropertyCandidate[]) {
  const byProperty = new Map<string, Ga4WebPropertyCandidate>();
  for (const candidate of candidates) {
    const propertyId = String(candidate.propertyId || "").trim();
    if (!propertyId) continue;
    byProperty.set(
      propertyId,
      mergeCandidate(byProperty.get(propertyId), { ...candidate, propertyId }),
    );
  }
  return Array.from(byProperty.values());
}

/**
 * Resolves the safest GA4 property for a site.
 *
 * Domain matches always win. When Google exposes a stale or empty stream URL,
 * we only fall back if the authorized account has exactly one accessible web
 * property. Multiple accessible properties remain blocked to avoid silently
 * connecting the professional to the wrong analytics data.
 */
export function selectGa4PropertyForDomain(
  domain: string,
  candidates: Ga4WebPropertyCandidate[],
): Ga4SelectionResult {
  const target = normalizeComparableDomain(domain);
  const accessible = uniqueByProperty(candidates);

  if (!target || accessible.length === 0) {
    return {
      ok: false,
      reason: "Aucune propriété GA4 ne correspond à ce domaine.",
      accessiblePropertyCount: accessible.length,
      matchingPropertyCount: 0,
    };
  }

  const exact = uniqueByProperty(
    candidates.filter(
      (candidate) =>
        Boolean(candidate.defaultUri) &&
        normalizeComparableDomain(candidate.defaultUri || "") === target,
    ),
  );
  if (exact.length === 1) {
    return {
      ok: true,
      candidate: exact[0]!,
      resolution: "exact_domain",
      accessiblePropertyCount: accessible.length,
      matchingPropertyCount: exact.length,
    };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      reason:
        "Plusieurs propriétés GA4 correspondent à ce domaine. Pour éviter une incohérence, l'application bloque la connexion. (Nettoyez / unifiez les propriétés GA4 ou contactez le support.)",
      accessiblePropertyCount: accessible.length,
      matchingPropertyCount: exact.length,
    };
  }

  const related = uniqueByProperty(
    candidates.filter(
      (candidate) =>
        (candidate.defaultUri && domainsLooselyMatch(candidate.defaultUri, target)) ||
        (candidate.displayName && domainsLooselyMatch(candidate.displayName, target)),
    ),
  );
  if (related.length === 1) {
    return {
      ok: true,
      candidate: related[0]!,
      resolution: "related_domain",
      accessiblePropertyCount: accessible.length,
      matchingPropertyCount: related.length,
    };
  }
  if (related.length > 1) {
    return {
      ok: false,
      reason:
        "Plusieurs propriétés GA4 correspondent à ce domaine. Pour éviter une incohérence, l'application bloque la connexion. (Nettoyez / unifiez les propriétés GA4 ou contactez le support.)",
      accessiblePropertyCount: accessible.length,
      matchingPropertyCount: related.length,
    };
  }

  if (accessible.length === 1) {
    return {
      ok: true,
      candidate: accessible[0]!,
      resolution: "single_accessible_property",
      accessiblePropertyCount: 1,
      matchingPropertyCount: 0,
    };
  }

  return {
    ok: false,
    reason:
      "Aucune propriété GA4 ne correspond à ce domaine parmi les propriétés Web accessibles. Renseignez le Property ID GA4 pour choisir la bonne propriété.",
    accessiblePropertyCount: accessible.length,
    matchingPropertyCount: 0,
  };
}
