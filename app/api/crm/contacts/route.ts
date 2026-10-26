import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { withApi } from "@/lib/observability/withApi";
import { commercialIdempotencyKey, commercialMutationId } from "@/lib/commercialMutationIdempotency";

type Category = "particulier" | "professionnel" | "collectivite_publique";
type ContactType = "client" | "prospect" | "fournisseur" | "partenaire" | "autre";

type ContactSummary = {
  total: number;
  prospects: number;
  clients: number;
  partenaires: number;
  fournisseurs: number;
  autres: number;
};

type ContactPayload = {
  user_id: string;
  last_name: string;
  first_name: string;
  company_name: string;
  siret: string;
  email: string;
  phone: string;
  address: string;
  billing_address: string;
  delivery_address: string;
  vat_number: string;
  city: string;
  postal_code: string;
  category: Category;
  contact_type: ContactType;
  notes?: string;
  important?: boolean;
};

type BulkImportStats = {
  inserted: number;
  skipped_duplicates: number;
  skipped_existing: number;
  ignored_invalid: number;
};

const CONTACT_SELECT = [
  "id",
  "user_id",
  "last_name",
  "first_name",
  "company_name",
  "siret",
  "email",
  "phone",
  "address",
  "billing_address",
  "delivery_address",
  "vat_number",
  "city",
  "postal_code",
  "category",
  "contact_type",
  "notes",
  "important",
  "created_at",
].join(", ");

function isCategory(v: unknown): v is Category {
  return v === "particulier" || v === "professionnel" || v === "collectivite_publique";
}

function isContactType(v: unknown): v is ContactType {
  return v === "client" || v === "prospect" || v === "fournisseur" || v === "partenaire" || v === "autre";
}

function cleanString(v: unknown) {
  if (typeof v !== "string") return "";
  return v.trim();
}

function isTransientPostgresTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(record.code || "").trim();
  const message = `${String(record.message || "")} ${String(record.details || "")}`;
  return code === "57014" || /statement timeout|canceling statement due to statement timeout/i.test(message);
}

async function waitBeforeDatabaseRetry() {
  await new Promise((resolve) => setTimeout(resolve, 180));
}

function normalizeImportKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_/\-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildImportRowMap(row: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  Object.entries(row || {}).forEach(([key, value]) => {
    map.set(key, value);
    const normalizedKey = normalizeImportKey(key);
    if (normalizedKey && !map.has(normalizedKey)) {
      map.set(normalizedKey, value);
    }
  });
  return map;
}

function pickImportedValue(map: Map<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const direct = map.get(key);
    if (direct != null && String(direct).trim() !== "") return direct;
    const normalizedKey = normalizeImportKey(key);
    const normalized = map.get(normalizedKey);
    if (normalized != null && String(normalized).trim() !== "") return normalized;
  }
  return "";
}

function mapImportedCategory(value: unknown): Category | "" {
  const normalized = normalizeImportKey(value);
  if (!normalized) return "";
  if (["particulier", "personne", "personne physique", "individual"].includes(normalized)) return "particulier";
  if (["professionnel", "professionnelle", "pro", "entreprise", "societe", "societe privee"].includes(normalized)) return "professionnel";
  if (["institution", "collectivite publique", "collectivite", "collectivite territoriale", "organisme public", "publique", "public", "mairie", "commune"].includes(normalized)) return "collectivite_publique";
  return "";
}

function mapImportedContactType(value: unknown): ContactType | "" {
  const normalized = normalizeImportKey(value);
  if (!normalized) return "";
  if (["client", "clients"].includes(normalized)) return "client";
  if (["prospect", "propsect", "prospects"].includes(normalized)) return "prospect";
  if (["fournisseur", "fournisseurs", "supplier"].includes(normalized)) return "fournisseur";
  if (["partenaire", "partenaires", "partner"].includes(normalized)) return "partenaire";
  if (["autre", "other", "others"].includes(normalized)) return "autre";
  return "";
}

function cleanDepartment(value: string | null) {
  const cleaned = (value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

  if (/^(97|98)\d/.test(cleaned)) return cleaned.slice(0, 3);
  return cleaned.slice(0, 2);
}

function parseImportantParam(value: string | null) {
  return ["1", "true", "yes", "oui"].includes((value ?? "").trim().toLowerCase());
}

function parseDisplayName(v: unknown) {
  const raw = cleanString(v);
  if (!raw) return { last_name: "", first_name: "", company_name: "" };

  const parts = raw.split("/");
  const left = cleanString(parts[0]);
  const right = cleanString(parts.slice(1).join("/"));

  // ⚠️ Heuristique simple (en attendant un vrai modèle Supabase):
  // - on stocke "Nom Prénom" dans last_name (first_name vide)
  // - la partie après "/" devient company_name
  return { last_name: left, first_name: "", company_name: right };
}

function normalizeEmailKey(value: unknown) {
  return cleanString(value).toLowerCase();
}

function normalizeFingerprintValue(value: unknown) {
  return cleanString(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildContactFingerprint(payload: Pick<ContactPayload, "last_name" | "first_name" | "company_name" | "phone">) {
  return [payload.last_name, payload.first_name, payload.company_name, payload.phone]
    .map(normalizeFingerprintValue)
    .filter(Boolean)
    .join("|");
}

function buildContactPayload(row: Record<string, unknown>, userId: string, opts?: { includeNotes?: boolean; includeImportant?: boolean }) {
  const map = buildImportRowMap(row);
  const displayNameValue = pickImportedValue(map, "display_name", "Nom / RS", "Nom", "Raison sociale", "Entreprise");
  const fromDisplay = parseDisplayName(displayNameValue);
  const rawCategory = pickImportedValue(map, "category", "Categorie", "Catégorie", "Category");
  const rawContactType = pickImportedValue(map, "contact_type", "Type", "Type de contact", "Contact type");
  const mappedCategory = mapImportedCategory(rawCategory);
  const mappedContactType = mapImportedContactType(rawContactType);

  const payload: ContactPayload = {
    user_id: userId,
    last_name: fromDisplay.last_name || cleanString(pickImportedValue(map, "last_name", "Nom")),
    first_name: fromDisplay.first_name || cleanString(pickImportedValue(map, "first_name", "Prénom", "Prenom")),
    company_name:
      fromDisplay.company_name ||
      cleanString(pickImportedValue(map, "company_name", "Entreprise", "Raison sociale", "Societe", "Société")),
    siret: cleanString(pickImportedValue(map, "siret", "SIRET")),
    email: cleanString(pickImportedValue(map, "email", "Email", "Mail", "E-mail")),
    phone: cleanString(pickImportedValue(map, "phone", "Téléphone", "Telephone", "Tel")),
    address: cleanString(pickImportedValue(map, "address", "Adresse", "Adresse principale")),
    billing_address: cleanString(pickImportedValue(map, "billing_address", "Adresse de facturation", "Billing address")),
    delivery_address: cleanString(pickImportedValue(map, "delivery_address", "Adresse de livraison", "Delivery address")),
    vat_number: cleanString(pickImportedValue(map, "vat_number", "TVA", "TVA intracom", "VAT", "VAT number")),
    city: cleanString(pickImportedValue(map, "city", "Ville")),
    postal_code: cleanString(pickImportedValue(map, "postal_code", "Code postal", "CP")),
    category: (isCategory(row.category) ? row.category : mappedCategory) || ("particulier" as Category),
    contact_type: (isContactType(row.contact_type) ? row.contact_type : mappedContactType) || ("prospect" as ContactType),
    ...(opts?.includeNotes ? { notes: cleanString(pickImportedValue(map, "notes", "Notes", "Commentaires", "Commentaire")) } : {}),
    ...(opts?.includeImportant ? { important: Boolean(row.important) } : {}),
  };

  if (!payload.last_name && !payload.first_name && !payload.company_name && !payload.email && !payload.phone) {
    return null;
  }

  return payload;
}

async function prepareBulkImportPayloads(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  userId: string,
  rows: unknown[],
  opts?: { includeNotes?: boolean; includeImportant?: boolean },
) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const mapped = sourceRows
    .map((row) => (row && typeof row === "object" && !Array.isArray(row) ? buildContactPayload(row as Record<string, unknown>, userId, opts) : null))
    .filter(Boolean) as ContactPayload[];

  let skippedDuplicates = 0;
  const seenEmails = new Set<string>();
  const seenFingerprints = new Set<string>();
  const deduped: ContactPayload[] = [];

  for (const payload of mapped) {
    const emailKey = normalizeEmailKey(payload.email);
    if (emailKey) {
      if (seenEmails.has(emailKey)) {
        skippedDuplicates += 1;
        continue;
      }
      seenEmails.add(emailKey);
      deduped.push(payload);
      continue;
    }

    const fingerprint = buildContactFingerprint(payload);
    if (fingerprint && seenFingerprints.has(fingerprint)) {
      skippedDuplicates += 1;
      continue;
    }
    if (fingerprint) seenFingerprints.add(fingerprint);
    deduped.push(payload);
  }

  let skippedExisting = 0;
  let payloads = deduped;

  if (seenEmails.size > 0) {
    const { data: existingRows, error } = await supabase
      .from("crm_contacts")
      .select("email")
      .eq("user_id", userId)
      .not("email", "is", null);

    if (error) throw error;

    const existingEmails = new Set((existingRows || []).map((row: any) => normalizeEmailKey(row?.email)).filter(Boolean));
    payloads = deduped.filter((payload) => {
      const emailKey = normalizeEmailKey(payload.email);
      if (!emailKey) return true;
      if (existingEmails.has(emailKey)) {
        skippedExisting += 1;
        return false;
      }
      return true;
    });
  }

  return {
    payloads,
    stats: {
      inserted: payloads.length,
      skipped_duplicates: skippedDuplicates,
      skipped_existing: skippedExisting,
      ignored_invalid: Math.max(0, sourceRows.length - mapped.length),
    } satisfies BulkImportStats,
  };
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function escapeIlikeValue(value: string) {
  return value
    .replace(/[%_]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/,+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyContactSearch<T>(builder: T, rawQuery: string): T {
  const cleaned = escapeIlikeValue(rawQuery);
  if (!cleaned) return builder;

  const pattern = `%${cleaned}%`;
  return (builder as any).or(
    [
      `last_name.ilike.${pattern}`,
      `first_name.ilike.${pattern}`,
      `company_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
      `address.ilike.${pattern}`,
      `billing_address.ilike.${pattern}`,
      `delivery_address.ilike.${pattern}`,
      `vat_number.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `postal_code.ilike.${pattern}`,
      `siret.ilike.${pattern}`,
    ].join(","),
  ) as T;
}

function applyContactFilters<T>(
  builder: T,
  filters: {
    category: string;
    contactType: string;
    department: string;
    importantOnly: boolean;
  },
): T {
  let next: any = builder;

  if (isCategory(filters.category)) {
    next = next.eq("category", filters.category);
  }

  if (isContactType(filters.contactType)) {
    next = next.eq("contact_type", filters.contactType);
  }

  if (filters.department) {
    next = next.like("postal_code", `${filters.department}%`);
  }

  if (filters.importantOnly) {
    next = next.eq("important", true);
  }

  return next as T;
}

async function buildSummary(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  userId: string,
  query: string,
  filters: {
    category: string;
    contactType: string;
    department: string;
    importantOnly: boolean;
  },
) {
  const countWithType = async (contactType?: ContactType) => {
    let builder: any = supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("user_id", userId);
    builder = applyContactSearch(builder, query);
    builder = applyContactFilters(builder, filters);
    if (contactType) {
      builder = builder.eq("contact_type", contactType);
    } else {
      builder = builder.or("contact_type.is.null,contact_type.eq.autre");
    }

    const { count, error } = await builder;
    if (error) throw error;
    return count ?? 0;
  };

  const [prospects, clients, partenaires, fournisseurs, autres] = await Promise.all([
    countWithType("prospect"),
    countWithType("client"),
    countWithType("partenaire"),
    countWithType("fournisseur"),
    countWithType(),
  ]);

  const total = prospects + clients + partenaires + fournisseurs + autres;

  return {
    total,
    prospects,
    clients,
    partenaires,
    fournisseurs,
    autres,
  } satisfies ContactSummary;
}

async function getContactsHandler(req: Request) {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  const url = new URL(req.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 100000);
  const all = ["1", "true", "yes"].includes((url.searchParams.get("all") ?? "").toLowerCase());
  const pageSize = all
    ? parsePositiveInt(url.searchParams.get("pageSize"), 20, 200)
    : 20;
  const query = cleanString(url.searchParams.get("q"));
  const filters = {
    category: cleanString(url.searchParams.get("category")),
    contactType: cleanString(url.searchParams.get("contactType")),
    department: cleanDepartment(url.searchParams.get("department")),
    importantOnly: parseImportantParam(url.searchParams.get("important")),
  };

  let builder: any = supabase
    .from("crm_contacts")
    .select(CONTACT_SELECT, { count: "exact" })
    .eq("user_id", activeUserId)
    .order("created_at", { ascending: false });

  builder = applyContactSearch(builder, query);
  builder = applyContactFilters(builder, filters);

  if (!all) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    builder = builder.range(from, to);
  }

  const [{ data, error, count }, summary] = await Promise.all([
    builder,
    buildSummary(supabase, activeUserId, query, filters),
  ]);

  if (error) {
    return jsonUserFacingError(error, { status: 500 });
  }

  const total = count ?? summary.total ?? 0;
  const pageCount = all ? (total > 0 ? 1 : 0) : Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    contacts: data ?? [],
    total,
    page: all ? 1 : page,
    pageSize: all ? Math.max(total, pageSize) : pageSize,
    pageCount,
    summary,
  });
}

async function createContactHandler(req: Request) {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  let idempotencyKey: string | null;
  try { idempotencyKey = commercialIdempotencyKey(req); }
  catch { return NextResponse.json({ error: "Clé de sauvegarde invalide." }, { status: 400 }); }

  const body = await req.json().catch(() => ({}));

  // ✅ Bulk import: POST { contacts: [...] }
  if (Array.isArray(body?.contacts)) {
    if (idempotencyKey) return NextResponse.json({ error: "Cette clé concerne une seule fiche contact." }, { status: 400 });
    const { payloads, stats } = await prepareBulkImportPayloads(supabase, activeUserId, body.contacts, {
      includeNotes: true,
      includeImportant: true,
    });

    if (payloads.length > 0) {
      const { error } = await supabase.from("crm_contacts").insert(payloads);
      if (error) {
        return jsonUserFacingError(error, { status: 500 });
      }
    }

    if (stats.inserted === 0 && stats.skipped_duplicates === 0 && stats.skipped_existing === 0) {
      return NextResponse.json({ error: "Aucune ligne importable." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...stats });
  }

  const fromDisplay = parseDisplayName(body.display_name);

  const payload = {
    user_id: activeUserId,
    last_name: fromDisplay.last_name || cleanString(body.last_name),
    first_name: fromDisplay.first_name || cleanString(body.first_name),
    company_name: fromDisplay.company_name || cleanString(body.company_name),
    siret: cleanString(body.siret),
    email: cleanString(body.email),
    phone: cleanString(body.phone),
    address: cleanString(body.address),
    billing_address: cleanString((body as any).billing_address),
    delivery_address: cleanString((body as any).delivery_address),
    vat_number: cleanString((body as any).vat_number),
    city: cleanString(body.city),
    postal_code: cleanString(body.postal_code),
    category: isCategory(body.category) ? body.category : ("particulier" as Category),
    contact_type: isContactType(body.contact_type) ? body.contact_type : ("prospect" as ContactType),
    notes: cleanString(body.notes),
    important: Boolean(body.important),
  };

  // minimum de validation
  if (!payload.last_name && !payload.first_name && !payload.company_name && !payload.email && !payload.phone) {
    return NextResponse.json(
      { error: "Renseigne au moins un champ d'identité (nom, prénom, mail ou téléphone)." },
      { status: 400 },
    );
  }

  const stableId = idempotencyKey ? commercialMutationId(activeUserId, idempotencyKey, "contact") : null;
  const recoverContact = async () => {
    const read = await supabase.from("crm_contacts").select(CONTACT_SELECT).eq("user_id", activeUserId).eq("id", stableId!).maybeSingle();
    if (read.error) return { response: jsonUserFacingError(read.error, { status: 500 }), found: false };
    if (!read.data) return { response: null, found: false };
    const saved = read.data as unknown as Record<string, unknown>;
    const same = Object.entries(payload).every(([field, value]) => typeof value === "boolean" ? saved[field] === value : cleanString(saved[field]) === value);
    return { found: true, response: same
      ? NextResponse.json({ ok: true, id: stableId, idempotent: true })
      : NextResponse.json({ error: "Cette demande a déjà enregistré une fiche différente. Vérifiez le CRM avant une nouvelle demande." }, { status: 409 }) };
  };
  if (stableId) {
    const recovered = await recoverContact();
    if (recovered.response) return recovered.response;
  }
  const insertContact = () =>
    supabase.from("crm_contacts").insert(stableId ? { ...payload, id: stableId } : payload).select("id").single();

  let result = await insertContact();
  if (isTransientPostgresTimeout(result.error)) {
    console.warn("[crm-contacts] transient insert timeout, retrying once", {
      accountId: activeUserId,
      code: String(result.error?.code || ""),
    });
    await waitBeforeDatabaseRetry();
    result = await insertContact();
  }

  if (result.error) {
    if (stableId) {
      const recovered = await recoverContact();
      if (recovered.response) return recovered.response;
    }
    return jsonUserFacingError(result.error, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: result.data?.id });
}

async function updateContactHandler(req: Request) {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  const body = await req.json().catch(() => ({}));

  // ✅ Bulk import: PUT { contacts: [...] }
  if (Array.isArray(body?.contacts)) {
    const { payloads, stats } = await prepareBulkImportPayloads(supabase, activeUserId, body.contacts);

    if (payloads.length > 0) {
      const { error } = await supabase.from("crm_contacts").insert(payloads);
      if (error) {
        return jsonUserFacingError(error, { status: 500 });
      }
    }

    if (stats.inserted === 0 && stats.skipped_duplicates === 0 && stats.skipped_existing === 0) {
      return NextResponse.json({ error: "Aucune ligne importable." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...stats });
  }
  const id = cleanString(body.id);
  if (!id) return NextResponse.json({ error: "L'identifiant du contact est manquant." }, { status: 400 });

  const fromDisplay = parseDisplayName(body.display_name);

  const patch = {
    last_name: fromDisplay.last_name || cleanString(body.last_name),
    first_name: fromDisplay.first_name || cleanString(body.first_name),
    company_name: fromDisplay.company_name || cleanString(body.company_name),
    siret: cleanString(body.siret),
    email: cleanString(body.email),
    phone: cleanString(body.phone),
    address: cleanString(body.address),
    billing_address: cleanString((body as any).billing_address),
    delivery_address: cleanString((body as any).delivery_address),
    vat_number: cleanString((body as any).vat_number),
    city: cleanString(body.city),
    postal_code: cleanString(body.postal_code),
    category: isCategory(body.category) ? body.category : ("particulier" as Category),
    contact_type: isContactType(body.contact_type) ? body.contact_type : ("prospect" as ContactType),
    // Keep these editable from the UI (star + notes)
    notes: cleanString(body.notes),
    important: typeof body.important === "boolean" ? body.important : Boolean(body.important),
  };

  const { error } = await supabase
    .from("crm_contacts")
    .update(patch)
    .eq("id", id)
    // double sécurité si RLS pas en place
    .eq("user_id", activeUserId);

  if (error) {
    return jsonUserFacingError(error, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function deleteContactHandler(req: Request) {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "L'identifiant du contact est manquant." }, { status: 400 });

  const { error } = await supabase
    .from("crm_contacts")
    .delete()
    .eq("id", id)
    // double sécurité si RLS pas en place
    .eq("user_id", activeUserId);

  if (error) {
    return jsonUserFacingError(error, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApi(getContactsHandler, { route: "/api/crm/contacts" });
export const POST = withApi(createContactHandler, { route: "/api/crm/contacts" });
export const PUT = withApi(updateContactHandler, { route: "/api/crm/contacts" });
export const DELETE = withApi(deleteContactHandler, { route: "/api/crm/contacts" });
