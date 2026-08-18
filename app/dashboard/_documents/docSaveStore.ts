"use client";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { createClient } from "@/lib/supabaseClient";
import {
  type DiscountKind,
  type DocKind,
  type DocRecord,
  type DocStatus,
  generateNumber,
  type LineItem,
  uid,
} from "./docUtils";

type DocSaveRow = {
  id: string;
  type: DocKind;
  name?: string | null;
  payload?: any;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeStatus(value: unknown, fallback: DocStatus = "brouillon"): DocStatus {
  if (
    value === "brouillon" ||
    value === "envoye" ||
    value === "paye" ||
    value === "en_attente_paiement" ||
    value === "accepte" ||
    value === "annule"
  ) {
    return value;
  }
  return fallback;
}

function normalizeLines(lines: unknown, vatDispense: boolean) {
  const input = Array.isArray(lines) ? lines : [];
  const mapped = input
    .map((line, index) => {
      const item = (line ?? {}) as Partial<LineItem>;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `l_${index + 1}`,
        label: typeof item.label === "string" ? item.label : "",
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        vatRate: vatDispense ? 0 : Number(item.vatRate) || 20,
      } satisfies LineItem;
    })
    .filter((line) => line.label || line.qty || line.unitPrice);

  return mapped.length
    ? mapped
    : [{ id: "l_1", label: "", qty: 1, unitPrice: 0, vatRate: vatDispense ? 0 : 20 }];
}

function toISODate(value: unknown, fallbackISO: string) {
  if (typeof value !== "string" || !value) return fallbackISO;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallbackISO;
  return d.toISOString();
}

export function normalizeDocSave(row: DocSaveRow): DocRecord {
  const payload = (row.payload ?? {}) as Record<string, any>;
  const kind = row.type;
  const vatDispense = !!payload.vatDispense;
  const fallbackISO = row.updated_at || row.created_at || new Date().toISOString();

  if (kind === "facture") {
    return {
      id: row.id,
      kind,
      number: String(payload.number || row.name || generateNumber("FAC")),
      createdAtISO: toISODate(payload.invoiceDate, fallbackISO),
      dueAtISO: payload.dueDate ? toISODate(payload.dueDate, fallbackISO) : null,
      clientName: String(payload.clientName || ""),
      clientAddress: String(payload.clientAddress || ""),
      clientEmail: String(payload.clientEmail || ""),
      status: normalizeStatus(payload.status, "brouillon"),
      lines: normalizeLines(payload.lines, vatDispense),
      vatDispense,
      isFinalized: !!payload.isFinalized,
      finalizedAtISO: payload.finalizedAt ? toISODate(payload.finalizedAt, fallbackISO) : null,
      lockedAtISO: payload.lockedAt ? toISODate(payload.lockedAt, fallbackISO) : null,
      discountKind: (payload.discountKind as DiscountKind | undefined) || undefined,
      discountValue: Number(payload.discountValue) || 0,
      discountDetails: String(payload.discountDetails || ""),
      paymentMethod: String(payload.paymentMethod || ""),
      paymentDetails: String(payload.paymentDetails || ""),
      notes: String(payload.notes || ""),
    };
  }

  return {
    id: row.id,
    kind,
    number: String(payload.number || row.name || generateNumber("DEV")),
    createdAtISO: toISODate(payload.docDateISO, fallbackISO),
    dueAtISO: null,
    clientName: String(payload.clientName || ""),
    clientAddress: String(payload.clientAddress || ""),
    clientEmail: String(payload.clientEmail || ""),
    status: normalizeStatus(payload.status, "brouillon"),
    lines: normalizeLines(payload.lines, vatDispense),
    vatDispense,
    validityDays: Math.max(1, Number(payload.validityDays) || 30),
    discountKind: (payload.discountKind as DiscountKind | undefined) || undefined,
    discountValue: Number(payload.discountValue) || 0,
    discountDetails: String(payload.discountDetails || ""),
  };
}

export async function fetchDocRecords(kind: DocKind): Promise<DocRecord[]> {
  const supabase = createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) return [];

  const { data, error } = await supabase
    .from("doc_saves")
    .select("id,type,name,payload,created_at,updated_at")
    .eq("user_id", resolveActiveBrowserUserId(user.id))
    .eq("type", kind)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as DocSaveRow[])
    .filter((row) => !((row.payload as Record<string, any> | undefined)?.isTemplate))
    .map(normalizeDocSave);
}

export async function deleteDocRecord(kind: DocKind, id: string) {
  const supabase = createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) return;

  const { error } = await supabase
    .from("doc_saves")
    .delete()
    .eq("user_id", resolveActiveBrowserUserId(user.id))
    .eq("type", kind)
    .eq("id", id);

  if (error) throw error;
}

export async function updateDocRecordStatus(kind: DocKind, id: string, status: DocStatus) {
  const supabase = createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) return;

  const { data, error } = await supabase
    .from("doc_saves")
    .select("payload")
    .eq("user_id", resolveActiveBrowserUserId(user.id))
    .eq("type", kind)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  const payload = { ...((data?.payload as Record<string, any> | undefined) ?? {}), status };

  const { error: updateError } = await supabase
    .from("doc_saves")
    .update({ payload, updated_at: new Date().toISOString() })
    .eq("user_id", resolveActiveBrowserUserId(user.id))
    .eq("type", kind)
    .eq("id", id);

  if (updateError) throw updateError;
}

export async function duplicateDocRecord(kind: DocKind, id: string) {
  const supabase = createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) return null;

  const { data, error } = await supabase
    .from("doc_saves")
    .select("payload")
    .eq("user_id", resolveActiveBrowserUserId(user.id))
    .eq("type", kind)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.payload) return null;

  const payload = { ...data.payload } as Record<string, any>;
  const now = new Date();
  const lines = normalizeLines(payload.lines, !!payload.vatDispense).map((line) => ({ ...line, id: uid("l") }));
  const nextPayload: Record<string, any> = {
    ...payload,
    number: generateNumber(kind === "devis" ? "DEV" : "FAC"),
    status: "brouillon",
    isFinalized: false,
    finalizedAt: null,
    lockedAt: null,
    officialNumberAssignedAt: null,
    officialSequenceYear: null,
    officialSequenceValue: null,
    lines,
  };

  if (kind === "devis") {
    nextPayload.docDateISO = now.toISOString().slice(0, 10);
  } else {
    const due = new Date(now);
    due.setDate(due.getDate() + 30);
    nextPayload.invoiceDate = now.toISOString().slice(0, 10);
    nextPayload.dueDate = due.toISOString().slice(0, 10);
  }

  const autoName =
    String(nextPayload.clientName || "").trim() ||
    String(nextPayload.clientEmail || "").trim() ||
    String(nextPayload.number || "").trim() ||
    "Sauvegarde";

  const { data: inserted, error: insertError } = await supabase
    .from("doc_saves")
    .insert({
      user_id: resolveActiveBrowserUserId(user.id),
      type: kind,
      name: autoName,
      payload: nextPayload,
      updated_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return inserted?.id as string | undefined;
}
