import "server-only";
import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import type { AssistantMediaAttachmentOriginal } from "./inrAssistantAttachmentStorage.ts";

type Row = Record<string, unknown>;
type MediaAttachment = { id: string; name: string; kind: string; size: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LINK = { label: "Mes médias", href: "/dashboard/mediatheque" };
const SELECT = "id,user_id,bucket_name,storage_path,source,title,updated_at,media_type,original_file_name";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function mediaIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25 || value.some(id => typeof id !== "string" || !UUID.test(id))) return null;
  const ids = value.map(id => String(id).toLowerCase());
  return new Set(ids).size === ids.length ? ids : null;
}
function permits(message: string, quote: unknown, verb: RegExp) {
  if (typeof quote !== "string" || !quote.trim() || quote.length > 1200 || !message.includes(quote)) return false;
  const stripQuoted = (text: string) => text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  const unquoted = stripQuoted(message), instruction = stripQuoted(quote).trim();
  // A quoted filename is a target, not an instruction. Only the action verb
  // outside quotations can authorize the operation.
  if (!instruction || !unquoted.includes(instruction)) return false;
  const text = normalize(unquoted);
  if (/^(?:comment|pourquoi|explique|imagine|suppose|how|why)\b|\b(?:ne|n['’]|sans|not|never|don't)\b.{0,45}(?:supprim|effac|import|ajout|enregistr|telecharg|download|delete)|\b(?:supprime|importe|telecharge)\s+pas\b/.test(text)) return false;
  if (/\b(?:si|if|quand|when|lorsque|unless|until)\b|\blorsqu['’]|\b(?:apres|after)\s+(?:ma|mon|son|ton|votre)?\s*(?:confirmation|accord|approval)\b/.test(text)) return false;
  return verb.test(normalize(instruction));
}
function selectsImportAttachment(quote: string, attachment: MediaAttachment, attachments: MediaAttachment[]) {
  const text = normalize(quote.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " "));
  const groups = [...text.matchAll(/\b(?:(?:ces|les)(?:\s+(deux|trois|quatre|\d+))?|(?:tous|toutes)\s+(?:les|ces))\s+(images|photos|videos|fichiers\s+audio|audios|sons|fichiers|medias|pieces\s+jointes|pj)\b/g)];
  if (groups.length) {
    if (/\b(?:sauf|except|hormis)\b/.test(text)) return false;
    const counts: Record<string, number> = { deux: 2, trois: 3, quatre: 4 };
    const candidates = groups.map(match => {
      const kind = /^(?:images|photos)$/.test(match[2]) ? "image" : match[2] === "videos" ? "video" : /^(?:audios|sons|fichiers\s+audio)$/.test(match[2]) ? "audio" : null;
      return { files: attachments.filter(file => !kind || file.kind === kind), count: match[1] ? counts[match[1]] ?? Number(match[1]) : null };
    });
    if (candidates.some(group => group.count !== null && group.count !== group.files.length)) return false;
    return candidates.some(group => group.files.some(file => file.id === attachment.id));
  }
  return attachments.length === 1 || normalize(quote).includes(normalize(attachment.name));
}
function nativeRequest(source: Request, path: string, method: string, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); }
  return new Request(new URL(path, source.url), { method, headers, body: JSON.stringify(body), signal: source.signal });
}
function fingerprint(rows: Row[]) {
  return assistantActionFingerprint([...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(item => Object.fromEntries(SELECT.split(",").map(key => [key, item[key] ?? null]))));
}

/** Fixed native endpoints only. All files are re-owned and all destructive
 * changes require the same user's exact signed preview, never an inferred yes. */
export function createInrAssistantMediaLibraryTools(options: {
  request: Request; accountId: string; actorUserId: string; edition: DashboardEdition;
  supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; currentApprovalMessage?: string;
  canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null;
  mediaAttachments?: MediaAttachment[];
  resolveMediaAttachment?: (id: string) => Promise<AssistantMediaAttachmentOriginal | null>;
  claimMediaAttachmentImport?: (id: string) => Promise<boolean>;
}) {
  const { request, accountId, actorUserId, supabase, currentUserMessage } = options;
  if (!UUID.test(accountId) || !UUID.test(actorUserId)) throw new Error("Périmètre média invalide");
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  const scope = async () => {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId;
  };
  const owned = async (ids: string[]) => {
    const result = await supabase.from("pro_media_library").select(SELECT).eq("user_id", accountId).in("id", ids);
    if (result.error || !Array.isArray(result.data)) throw new Error("Lecture des médias indisponible");
    const records = result.data.map(row);
    if (records.some(item => item.user_id !== accountId || !ids.includes(String(item.id)) || item.source === "ai_media_generation_draft" || item.bucket_name !== "inrcy-pro-media" || typeof item.storage_path !== "string" || !item.storage_path.startsWith(`users/${accountId}/`) || item.storage_path.includes("..") || item.storage_path.includes("\\"))) throw new Error("Média non admissible");
    return records;
  };
  const availableAttachments = () => (options.mediaAttachments ?? []).filter(item => UUID.test(item.id) && ["image", "video", "audio"].includes(item.kind)).slice(0, 4);
  const attempts = new Map<string, Promise<Row>>();
  const once = (key: string, action: () => Promise<Row>) => {
    if (!attempts.has(key)) attempts.set(key, action().catch(() => fail("unknown", "Le résultat doit être vérifié dans Mes médias avant une nouvelle tentative.")));
    return attempts.get(key)!;
  };
  const idsSchema = { type: "array", minItems: 1, maxItems: 25, uniqueItems: true, items: { type: "string", format: "uuid" } } as const;
  const quoteSchema = { type: "string", minLength: 1, maxLength: 1200 } as const;
  return {
    listImportableMediaAttachments: tool({ strict: true,
      description: "Lister les images/vidéos/fichiers audio MP3-WAV joints à la demande ACTUELLE qui peuvent être importées dans Mes médias. Aucun historique ni fichier externe, aucun import déclenché. Utiliser ces IDs dans importMediaAttachment.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async () => !await scope() ? fail("blocked", "L’import doit être autorisé pour le compte actif.") : { ok: true, status: "read", attachments: availableAttachments().map(({ id, name, kind, size }) => ({ id, name, kind, size })), nextAction: LINK, untrustedContent: true },
    }),
    importMediaAttachment: tool({ strict: true,
      description: "Importer dans Mes médias l’ORIGINAL d’une image/vidéo ou d’un audio MP3-WAV joint sur ordre explicite. Choisir son ID via listImportableMediaAttachments ; plusieurs fichiers exigent leur nom ou un groupe explicite (ces deux images, toutes les vidéos, ces deux fichiers audio, tous les fichiers joints). Respecter type et nombre exacts, sinon demander quels fichiers. Pipeline natif, aucune publication/génération ni URL source inventée ou aperçu compressé.",
      inputSchema: jsonSchema<{ attachmentId: string; instructionQuote: string }>({ type: "object", properties: { attachmentId: { type: "string", format: "uuid" }, instructionQuote: quoteSchema }, required: ["attachmentId", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const attachments = availableAttachments(), attachment = attachments.find(item => item.id === input.attachmentId);
        if (!attachment || !permits(currentUserMessage, input.instructionQuote, /\b(?:importe\w*|ajoute\w*|enregistr\w*|sauvegarde\w*|import|save|add)\b/) || !/mediatheque|mes medias|bibliotheque|library/.test(normalize(currentUserMessage)) || !selectsImportAttachment(input.instructionQuote, attachment, attachments)) return fail("needs_instruction", "Indiquez quels fichiers importer dans Mes médias ; leur type et leur nombre doivent correspondre aux pièces jointes.");
        if (!await scope()) return fail("blocked", "L’import n’est pas autorisé dans le compte actif.");
        return once(`import:${attachment.id}`, async () => {
          const source = `assistant_attachment_${createHash("sha256").update(`${accountId}:${actorUserId}:${attachment.id}`).digest("hex").slice(0, 40)}`;
          const previous = await supabase.from("pro_media_library").select("id,user_id,source").eq("user_id", accountId).eq("source", source).limit(2);
          if (previous.error || !Array.isArray(previous.data)) return fail("unavailable", "Les imports précédents ne peuvent pas être vérifiés.");
          if (previous.data.length) {
            const existing = row(previous.data[0]);
            const verified = previous.data.length === 1 && existing.user_id === accountId && existing.source === source && UUID.test(String(existing.id)) ? await owned([String(existing.id)]) : [];
            return verified.length === 1 && verified[0].source === source
              ? { ok: true, status: "already_processed", mediaId: existing.id, id: existing.id, message: "Ce fichier est déjà importé dans Mes médias. Aucun doublon créé.", nextAction: LINK }
              : fail("unknown", "L’import existant doit être vérifié dans Mes médias.");
          }
          const original = await options.resolveMediaAttachment?.(attachment.id);
          if (!original || original.id !== attachment.id || original.name !== attachment.name || original.kind !== attachment.kind || original.size !== attachment.size || !Buffer.isBuffer(original.bytes) || original.bytes.length !== original.size) return fail("needs_input", "L’original de cette pièce jointe n’est plus disponible. Joignez de nouveau le fichier à importer.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          if (!await options.claimMediaAttachmentImport?.(attachment.id)) return fail("unknown", "Un import de cette pièce jointe a déjà été réservé ou ne peut pas être sécurisé. Vérifiez Mes médias ; aucun doublon n’a été lancé.");
          const native = await import("@/app/api/media-library/upload/route");
          const preparedResponse = await native.POST(nativeRequest(request, "/api/media-library/upload", "POST", { mode: "prepare", files: [{ client_id: attachment.id, name: original.name, type: original.mimeType, size: original.size }] }) as never);
          const prepared = row(await preparedResponse.json()), destination = row(Array.isArray(prepared.items) ? prepared.items[0] : null);
          if (!preparedResponse.ok || prepared.ok !== true || destination.client_id !== attachment.id || destination.bucket !== "inrcy-pro-media" || typeof destination.storage_path !== "string" || !destination.storage_path.startsWith(`users/${accountId}/`) || destination.storage_path.includes("..") || destination.storage_path.includes("\\") || typeof destination.token !== "string" || destination.content_type !== original.mimeType) return fail("unavailable", "L’import natif n’a pas pu être préparé. Aucun média enregistré.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const transfer = await supabaseAdmin.storage.from("inrcy-pro-media").uploadToSignedUrl(destination.storage_path, destination.token, original.bytes, { contentType: original.mimeType });
          if (transfer.error) return fail("unknown", "Le transfert n’est pas confirmé. Vérifiez Mes médias avant une nouvelle tentative.");
          if (!await scope()) return fail("unknown", "Le transfert a commencé mais le compte actif a changé. Aucun nouvel import lancé.");
          const response = await native.POST(nativeRequest(request, "/api/media-library/upload", "POST", { mode: "finalize", source, uploads: [{ original_name: original.name, storage_path: destination.storage_path, mime_type: original.mimeType, size_bytes: original.size, width: null, height: null, duration_seconds: null, upload_protocol: "signed" }] }) as never);
          const result = row(await response.json()), item = row(Array.isArray(result.results) ? result.results[0] : null);
          if (!response.ok || result.ok !== true || item.ok !== true || !UUID.test(String(item.id))) return fail("unknown", "L’enregistrement n’est pas confirmé. Vérifiez Mes médias avant une nouvelle tentative.");
          const records = await owned([String(item.id)]);
          if (records.length !== 1 || records[0].source !== source || records[0].media_type !== original.kind) return fail("saved_unconfirmed", "Le fichier a été transmis ; sa présence dans Mes médias reste à vérifier.");
          return { ok: true, status: "imported", id: item.id, mediaId: item.id, message: "Le fichier original est importé et vérifié dans Mes médias. Aucun contenu publié.", nextAction: LINK };
        });
      },
    }),
    prepareMediaDownload: tool({ strict: true,
      description: "Demander au navigateur le téléchargement ZIP natif de 1 à 25 médias explicitement demandés, après recherche/sélection. Revalide tous les fichiers du compte actif, aucun lien externe. Le résultat est une demande au navigateur, jamais une preuve de fichier téléchargé.",
      inputSchema: jsonSchema<{ mediaIds: string[]; instructionQuote: string }>({ type: "object", properties: { mediaIds: idsSchema, instructionQuote: quoteSchema }, required: ["mediaIds", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const ids = mediaIds(input.mediaIds);
        if (!ids || !permits(currentUserMessage, input.instructionQuote, /\b(?:telecharg\w*|export\w*|download)\b/)) return fail("needs_instruction", "Indiquez les médias à télécharger.");
        if (!await scope()) return fail("blocked", "Le compte actif doit être vérifié.");
        try {
          if ((await owned(ids)).length !== ids.length) return fail("not_found", "Certains médias ne sont plus disponibles dans cet établissement.");
          return { ok: true, status: "ui_action_requested", uiCommand: { command: "download_media", mediaIds: ids, selection: { kind: "media", id: ids[0] }, pathname: "/dashboard/mediatheque" }, message: "Le téléchargement des médias sélectionnés a été demandé au navigateur.", nextAction: LINK };
        } catch { return fail("unavailable", "Les médias ne peuvent pas être vérifiés. Aucun téléchargement lancé."); }
      },
    }),
    previewMediaDeletion: tool({ strict: true,
      description: "Préparer un aperçu de suppression DÉFINITIVE de 1 à 25 médias explicitement demandés. Afficher tous les noms, le nombre et le caractère irréversible ; demander Confirme IA-… avant applyMediaDeletion. Rien n’est supprimé ici. Les aperçus Studio non acceptés et les médias utilisés dans un brouillon/programmation gardent leurs validations natives.",
      inputSchema: jsonSchema<{ mediaIds: string[]; instructionQuote: string }>({ type: "object", properties: { mediaIds: idsSchema, instructionQuote: quoteSchema }, required: ["mediaIds", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const ids = mediaIds(input.mediaIds);
        if (!ids || !permits(currentUserMessage, input.instructionQuote, /\b(?:supprime\w*|efface\w*|delete|remove)\b/)) return fail("needs_instruction", "Désignez les médias à supprimer définitivement.");
        if (!await scope()) return fail("blocked", "La suppression n’est pas autorisée dans le compte actif.");
        try {
          const records = await owned(ids);
          if (records.length !== ids.length) return fail("not_found", "Tous les médias désignés doivent être présents dans cet établissement.");
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "media_delete", targetId: ids[0], fingerprint: fingerprint(records), patch: { mediaIds: ids } });
          return { ok: true, status: "preview_ready", approvalKind: "media_delete", ...preview, proposal: { mediaIds: ids, count: ids.length, items: records.map(item => ({ id: item.id, name: sanitizeInrAssistantMemoryText(String(item.title || item.original_file_name || "Média"), 180) })), irreversible: true, effect: "Suppression définitive des originaux et de leurs variantes. Les médias encore utilisés seront bloqués par le contrôle natif, sans forcer leur suppression." }, message: `Vérifiez les ${ids.length} média(s) désignés. Suppression définitive ; dites « Confirme ${preview.reference} » pour l’autoriser.`, nextAction: LINK, untrustedContent: true };
        } catch { return fail("unavailable", "L’aperçu de suppression ne peut pas être préparé. Aucun média supprimé."); }
      },
    }),
    applyMediaDeletion: tool({ strict: true,
      description: "Supprimer uniquement les médias de l’aperçu signé media_delete que le pro confirme MAINTENANT avec sa référence IA-. Revalide compte/acteur/liste inchangée ; appelle DELETE natif sans force. Les médias utilisés dans des programmations/brouillons doivent passer leur confirmation native. N’accepte ni oui seul, ni délai/condition, ni ID de média fourni à la place de l’aperçu.",
      inputSchema: jsonSchema<{ reference: string; instructionQuote: string }>({ type: "object", properties: { reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: quoteSchema }, required: ["reference", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const preview = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "media_delete" });
        const ids = mediaIds(preview?.patch.mediaIds);
        if (!preview || preview.reference !== input.reference || !ids || preview.targetId !== ids[0] || !hasAssistantActionApproval(options.currentApprovalMessage ?? currentUserMessage, input.instructionQuote, preview.reference)) return fail("confirmation_required", "Confirmez la référence exacte d’un aperçu de suppression valide.");
        if (!await scope()) return fail("blocked", "La suppression n’est pas autorisée dans le compte actif.");
        return once(`delete:${preview.reference}`, async () => {
          const records = await owned(ids);
          if (!records.length) return { ok: true, status: "already_processed", recordId: ids[0], deletedIds: ids, message: "Ces médias sont déjà absents de la médiathèque. Aucune nouvelle suppression.", nextAction: LINK };
          if (records.length !== ids.length || fingerprint(records) !== preview.fingerprint) return fail("stale_preview", "La sélection a changé. Demandez un nouvel aperçu de suppression.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const native = await import("@/app/api/media-library/items/route");
          const response = await native.DELETE(nativeRequest(request, "/api/media-library/items", "DELETE", { ids, force: false }) as never);
          const result = row(await response.json());
          if (response.status === 409 && result.requiresConfirmation === true) return fail("needs_native_confirmation", "Un média est encore utilisé dans une programmation, campagne ou brouillon. Ouvrez Mes médias pour vérifier ces utilisations et confirmer leur suppression. Rien n’a été forcé.");
          if (!response.ok || result.ok !== true || result.deleted !== ids.length) return fail("unknown", "La suppression n’est pas confirmée. Vérifiez Mes médias avant une nouvelle tentative.");
          if ((await owned(ids)).length) return fail("unknown", "Certains médias sont encore présents. Vérifiez la sélection avant une nouvelle tentative.");
          return { ok: true, status: "deleted", recordId: ids[0], deletedIds: ids, message: `${ids.length} média(s) supprimé(s) définitivement et absence vérifiée dans Mes médias.`, nextAction: LINK };
        });
      },
    }),
  };
}
