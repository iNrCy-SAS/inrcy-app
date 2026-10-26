import "server-only";

import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "@/lib/requireUser";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { currentSubscriptionOffer } from "./subscriptionOffers.ts";
import {
  INR_AGENT_AUTOMATION_KEYS, INR_AGENT_CHANNELS, INR_AGENT_FREQUENCIES, INR_AGENT_THEMES, INR_AGENT_DEFAULT_SETTINGS,
  INR_AGENT_RECIPIENT_SCOPES, INR_AGENT_PREFERRED_MEDIA_SOURCES, INR_AGENT_VALIDATION_MODES,
  sanitizeInrAgentSettings, type InrAgentAutomationKey, type InrAgentSettings,
} from "./inrAgentSettings.ts";
import { inrAgentMonthlyDateCount } from "./inrAgentMonthSchedule.ts";

type Row = Record<string, unknown>;
type Slot = { dayOfWeek: number; time: string };
type Schedule = { frequency: typeof INR_AGENT_FREQUENCIES[number]; timezone: string; slots?: Slot[] | null; monthDays?: number[] | null; time?: string | null };
type AgentInput = {
  agent: InrAgentAutomationKey; enabled?: boolean | null; schedule?: Schedule | null;
  channels?: typeof INR_AGENT_CHANNELS[number][] | null; themes?: typeof INR_AGENT_THEMES[number][] | null;
  recipientScope?: typeof INR_AGENT_RECIPIENT_SCOPES[number] | null;
  validationMode?: typeof INR_AGENT_VALIDATION_MODES[number] | null;
  preferredMediaSource?: typeof INR_AGENT_PREFERRED_MEDIA_SOURCES[number] | null;
  planningHorizonDays?: 7 | 15 | 30 | null;
};
const BILLING_ACTIONS = ["compare", "subscribe", "change_plan", "manage", "cancel", "invoices"] as const;
type BillingInput = { action: typeof BILLING_ACTIONS[number]; plan?: "Basic" | "Standard" | "Premium" | null; billingCycle?: "monthly" | "yearly" | null };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MARKER = "assistantManagementAction";
const AGENT_LINKS: Record<InrAgentAutomationKey, { label: string; href: string }> = {
  publish: { label: "Agent Publications", href: "/dashboard/agent/publications" },
  stats: { label: "Agent Stats", href: "/dashboard/agent/stats" },
  grow: { label: "Agent Emailings — Propulser", href: "/dashboard/agent/campagnes-mails" },
  loyalty: { label: "Agent Emailings — Fidéliser", href: "/dashboard/agent/campagnes-mails" },
};
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const member = <T extends string>(value: unknown, choices: readonly T[]): value is T => typeof value === "string" && choices.includes(value as T);
const keys = (input: Row, allowed: readonly string[]) => Object.keys(input).every(key => allowed.includes(key));
class ManagementInputError extends Error {}
const invalid = () => new ManagementInputError("Précisez les réglages demandés et leur horaire avant de les enregistrer.");

function parseBilling(value: unknown): BillingInput {
  const input = record(value);
  if (!keys(input, ["action", "plan", "billingCycle"]) || !member(input.action, BILLING_ACTIONS) ||
    (input.plan != null && !member(input.plan, ["Basic", "Standard", "Premium"])) ||
    (input.billingCycle != null && !member(input.billingCycle, ["monthly", "yearly"]))) throw invalid();
  return input as BillingInput;
}
function parseAgent(value: unknown): AgentInput {
  const input = record(value);
  if (!keys(input, ["agent", "enabled", "schedule", "channels", "themes", "recipientScope", "validationMode", "preferredMediaSource", "planningHorizonDays"]) ||
    !member(input.agent, INR_AGENT_AUTOMATION_KEYS) || (input.enabled != null && typeof input.enabled !== "boolean") ||
    (input.recipientScope != null && !member(input.recipientScope, INR_AGENT_RECIPIENT_SCOPES)) ||
    (input.validationMode != null && !member(input.validationMode, INR_AGENT_VALIDATION_MODES)) ||
    (input.preferredMediaSource != null && !member(input.preferredMediaSource, INR_AGENT_PREFERRED_MEDIA_SOURCES)) ||
    (input.planningHorizonDays != null && (!Number.isInteger(input.planningHorizonDays) || ![7, 15, 30].includes(Number(input.planningHorizonDays))))) throw invalid();
  for (const [field, choices] of [["channels", INR_AGENT_CHANNELS], ["themes", INR_AGENT_THEMES]] as const) {
    const list = input[field];
    if (list != null && (!Array.isArray(list) || list.length > choices.length || list.some(item => !member(item, choices)) || new Set(list).size !== list.length)) throw invalid();
  }
  const defaults = INR_AGENT_DEFAULT_SETTINGS.automations[input.agent];
  if (Array.isArray(input.channels) && input.channels.some(channel => !defaults.allowedChannels.some(allowed => allowed === channel)) ||
    Array.isArray(input.themes) && input.themes.some(theme => !defaults.allowedThemes.some(allowed => allowed === theme))) throw invalid();
  if ((input.agent === "publish" && input.validationMode != null && input.validationMode !== "notify_before_validation") ||
    (input.agent === "stats" && input.validationMode != null && input.validationMode !== "automatic_report") ||
    (["grow", "loyalty"].includes(input.agent) && input.validationMode === "automatic_report")) throw invalid();
  if (input.schedule != null) {
    const schedule = record(input.schedule);
    if (!keys(schedule, ["frequency", "timezone", "slots", "monthDays", "time"]) || !member(schedule.frequency, INR_AGENT_FREQUENCIES) ||
      typeof schedule.timezone !== "string" || schedule.timezone.length > 80) throw invalid();
    try { new Intl.DateTimeFormat("fr", { timeZone: schedule.timezone }).format(); } catch { throw invalid(); }
    const monthly = inrAgentMonthlyDateCount(schedule.frequency);
    if (monthly) {
      if (!Array.isArray(schedule.monthDays) || schedule.monthDays.length !== monthly || new Set(schedule.monthDays).size !== monthly ||
        schedule.monthDays.some(day => !Number.isInteger(day) || day < 1 || day > 31) || typeof schedule.time !== "string" || !TIME.test(schedule.time) ||
        (schedule.slots != null && (!Array.isArray(schedule.slots) || schedule.slots.length))) throw invalid();
    } else {
      const count = schedule.frequency === "three_times_weekly" ? 3 : schedule.frequency === "twice_weekly" ? 2 : 1;
      if (!Array.isArray(schedule.slots) || schedule.slots.length !== count || schedule.slots.some(value => {
        const slot = record(value);
        return !keys(slot, ["dayOfWeek", "time"]) || !Number.isInteger(slot.dayOfWeek) || Number(slot.dayOfWeek) < 0 || Number(slot.dayOfWeek) > 6 || typeof slot.time !== "string" || !TIME.test(slot.time);
      }) || new Set(schedule.slots.map(value => { const slot = record(value); return `${slot.dayOfWeek}:${slot.time}`; })).size !== count ||
        (schedule.monthDays != null && (!Array.isArray(schedule.monthDays) || schedule.monthDays.length))) throw invalid();
    }
    if (schedule.frequency === "one_off" || (schedule.frequency === "quarterly" && ["publish", "grow"].includes(input.agent))) throw invalid();
  }
  return input as AgentInput;
}

function hasAgentInstruction(message: string, input: AgentInput) {
  const aliases = { publish: /\b(?:publications?|publier|editorial|booster)\b/, stats: /\b(?:stats|statistiques|bilans?|rapports?)\b/,
    grow: /\b(?:propulser|prospection|prospects?|acquisition)\b/, loyalty: /\b(?:fideliser|fidelisation|loyalty)\b/ }[input.agent];
  return normalized(message).split(/[.!?;\n]|\bmais\b|\bet\b|\band\b/).some(clause => {
    const allAgents = /\b(?:tous|all)\b.{0,16}\bagents\b/.test(clause);
    if ((!aliases.test(clause) && !allAgents) || /\b(?:comment|pourquoi|explique|expliquer|si je|si on|si tu|pas|never|not)\b/.test(clause)) return false;
    if (input.enabled === true) return /\b(?:active|activer|activez|activate|enable|demarre|lance)\b/.test(clause);
    if (input.enabled === false) return /\b(?:desactive|desactiver|desactivez|arrete|suspend|pause|stop|disable)\b/.test(clause);
    return /\b(?:configure|configurer|regle|regler|modifie|modifier|change|changer|mets|programme|programmer|set|update)\b/.test(clause);
  });
}

function trustedRequest(source: Request, body?: unknown) {
  const headers = new Headers({ accept: "application/json" });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  if (body !== undefined) headers.set("content-type", "application/json");
  // Only this fixed local handler is called. Preserve the trusted request origin
  // for its existing editorial callbacks; no URL is supplied by the model.
  return new Request(new URL("/api/agent/settings", source.url), { method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: source.signal });
}
async function payload(response: Response): Promise<Row> { return record(await response.json().catch(() => null)); }
function summary(settings: InrAgentSettings, agent: InrAgentAutomationKey) {
  const item = settings.automations[agent];
  let timezone: string | null = null;
  try { if (settings.timezone.length <= 80) { new Intl.DateTimeFormat("fr", { timeZone: settings.timezone }).format(); timezone = settings.timezone; } } catch { /* Do not echo a corrupt stored value. */ }
  return { enabled: item.enabled, globalEnabled: settings.globalEnabled, frequency: item.frequency, timezone,
    dayOfWeek: item.dayOfWeek, time: item.time, channels: item.allowedChannels, themes: item.allowedThemes,
    validationMode: item.validationMode, recipientScope: item.recipientScope, preferredMediaSource: item.preferredMediaSource,
    planningHorizonDays: item.planningHorizonDays,
    slots: Array.isArray(item.metadata.scheduleSlots) ? item.metadata.scheduleSlots.slice(0, 3).map(value => { const slot = record(value); return {
      dayOfWeek: Number.isInteger(slot.dayOfWeek) && Number(slot.dayOfWeek) >= 0 && Number(slot.dayOfWeek) <= 6 ? slot.dayOfWeek : null,
      time: typeof slot.time === "string" && TIME.test(slot.time) ? slot.time : null }; }) : [],
    monthDays: Array.isArray(item.metadata.monthDays) ? item.metadata.monthDays.slice(0, 3).filter(day => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 31) : [],
    nextRunAt: typeof item.nextRunAt === "string" && Number.isFinite(Date.parse(item.nextRunAt)) ? item.nextRunAt : null };
}
function sameSettings(left: InrAgentSettings, right: InrAgentSettings, agent: InrAgentAutomationKey) {
  const { nextRunAt: _leftRun, ...a } = summary(left, agent);
  const { nextRunAt: _rightRun, ...b } = summary(right, agent);
  return JSON.stringify(a) === JSON.stringify(b);
}
const nullableEnum = (values: readonly string[]): JSONSchema7 => ({ type: ["string", "null"], enum: [...values, null] });
const nullableList = (values: readonly string[]): JSONSchema7 => ({ type: ["array", "null"], maxItems: values.length, items: { type: "string", enum: [...values] } });

/** Scope, edition and the CURRENT user instruction are supplied by the server. */
export function createInrAssistantManagementTools(options: {
  request: Request; accountId: string; actorUserId: string; edition: DashboardEdition;
  currentUserMessage: string; actionRequestId: string;
}) {
  if (!UUID.test(options.accountId) || !UUID.test(options.actorUserId) || !["standard", "premium", "founder"].includes(options.edition) ||
    typeof options.currentUserMessage !== "string" || options.currentUserMessage.length > 4_000 || !/^[a-z0-9][a-z0-9_-]{7,179}$/i.test(options.actionRequestId)) throw new Error("Invalid management scope.");
  const operations = new Map<string, Promise<unknown>>();
  async function assertScope() {
    const auth = await requireUser().catch(() => null);
    if (!auth) throw new ManagementInputError("La session n’a pas pu être vérifiée. Rouvrez l’assistant avant de modifier les réglages.");
    if (auth.errorResponse || auth.authUserId !== options.actorUserId || auth.activeUserId !== options.accountId) throw new ManagementInputError("L’établissement actif a changé. Rouvrez l’assistant avant de modifier les réglages.");
  }
  return {
    prepareSubscriptionAction: tool({
      strict: true,
      description: "Préparer le parcours public d’abonnement, comparaison, souscription/changement, factures ou résiliation demandé maintenant. Retourne le vrai lien Mon abonnement/Factures et un récapitulatif du catalogue web ; aucun checkout, paiement, changement ou résiliation n’est exécuté. Le pro finalise dans les confirmations existantes ou chez Apple/Google. Un tarif de catalogue ne remplace jamais son contrat.",
      inputSchema: jsonSchema<BillingInput>({ type: "object", properties: { action: { type: "string", enum: [...BILLING_ACTIONS] }, plan: nullableEnum(["Basic", "Standard", "Premium"]), billingCycle: nullableEnum(["monthly", "yearly"]) }, required: ["action", "plan", "billingCycle"], additionalProperties: false }, {
        validate: input => { try { return { success: true, value: parseBilling(input) }; } catch (error) { return { success: false, error: error as Error }; } },
      }),
      execute: async value => {
        const input = parseBilling(value);
        await assertScope();
        if (!/abonn|offre|basic|basique|premium|standard|factur|souscri|resili|cancel|subscription|billing/i.test(normalized(options.currentUserMessage))) return { ok: false, status: "instruction_required", message: "Demandez au pro quel parcours d’abonnement il souhaite ouvrir." };
        const link = input.action === "invoices" ? { label: "Factures d’abonnement", href: "/dashboard?panel=factures" } : { label: "Mon abonnement", href: "/dashboard?panel=abonnement" };
        if (["subscribe", "change_plan"].includes(input.action) && (!input.plan || !input.billingCycle)) return { ok: false, status: "details_required", link, message: "Demandez le forfait et le choix mensuel ou annuel avant de préparer la souscription." };
        const catalogue = (input.plan ? [input.plan] : ["Basic", "Standard", "Premium"] as const).map(plan => {
          const offer = currentSubscriptionOffer(plan);
          return { plan, monthlyEur: offer.monthlyPriceEur, yearlyEur: offer.yearlyPriceEur, taxBehavior: offer.taxBehavior, currency: "EUR", source: "public_web_catalogue_not_personal_contract" };
        });
        const steps = input.action === "invoices" ? ["Mon compte → Factures, puis Voir ou PDF lorsque disponible."]
          : input.action === "cancel" ? ["Mon compte → Abonnement → Programmer ma résiliation, puis vérifier et confirmer la date affichée.", "Un abonnement App Store/Google Play se résilie dans sa boutique. La confirmation du fournisseur fait foi."]
          : input.action === "manage" ? ["Mon compte → Abonnement → Gérer ma facturation, puis suivre le portail du fournisseur."]
          : ["Mon compte → Abonnement : choisir la carte du forfait et Mensuel/Annuel.", "Vérifier le récapitulatif, les taxes, l’échéance et l’activation de l’essai si proposée, puis confirmer dans le parcours existant."];
        return { ok: true, status: "requires_user_completion", action: input.action, link, selection: { plan: input.plan ?? null, billingCycle: input.billingCycle ?? null }, catalogue,
          managedEdition: options.edition === "founder", steps, billingChanged: false,
          message: "Parcours préparé. Le prix et les conditions réels restent ceux du compte et du récapitulatif fournisseur ; le pro valide la dernière étape." };
      },
    }),
    configureAgentAutomation: tool({
      strict: true,
      description: "Modifier uniquement les réglages de l’agent explicitement demandé DANS LE DERNIER MESSAGE DU PRO : activation/pause, fréquence, horaires complets, canaux, thèmes, destinataires par catégorie ou préférence médias. Standard : publish/stats ; Premium ajoute grow/loyalty. Une nouvelle activation exige un planning complet et son fuseau actuel, sans inventer d’heure. biweekly signifie DEUX DATES PAR MOIS, pas une semaine sur deux. slots: jour0dimanche→6samedi, 1/2/3 créneaux selon fréquence ; mensualités : monthDays exacts et time. Conserve les autres agents, destinataires précis, références et métadonnées. Ne publie/envoie aucune campagne directement ; Stats activé en automatic_report peut envoyer ses bilans selon le planning. L’API garde les contrôles de crédit et de modification du planning ; une confirmation exigée reste à finaliser dans le module.",
      inputSchema: jsonSchema<AgentInput>({ type: "object", properties: {
        agent: { type: "string", enum: [...INR_AGENT_AUTOMATION_KEYS] }, enabled: { type: ["boolean", "null"] },
        schedule: { type: ["object", "null"], properties: {
          frequency: { type: "string", enum: INR_AGENT_FREQUENCIES.filter(value => value !== "one_off") }, timezone: { type: "string", maxLength: 80 },
          slots: { type: ["array", "null"], maxItems: 3, items: { type: "object", properties: { dayOfWeek: { type: "integer", minimum: 0, maximum: 6 }, time: { type: "string", pattern: TIME.source } }, required: ["dayOfWeek", "time"], additionalProperties: false } },
          monthDays: { type: ["array", "null"], maxItems: 3, items: { type: "integer", minimum: 1, maximum: 31 } }, time: { type: ["string", "null"] },
        }, required: ["frequency", "timezone", "slots", "monthDays", "time"], additionalProperties: false },
        channels: nullableList(INR_AGENT_CHANNELS), themes: nullableList(INR_AGENT_THEMES), recipientScope: nullableEnum(INR_AGENT_RECIPIENT_SCOPES),
        validationMode: nullableEnum(INR_AGENT_VALIDATION_MODES), preferredMediaSource: nullableEnum(INR_AGENT_PREFERRED_MEDIA_SOURCES),
        planningHorizonDays: { type: ["integer", "null"], enum: [7, 15, 30, null] },
      }, required: ["agent", "enabled", "schedule", "channels", "themes", "recipientScope", "validationMode", "preferredMediaSource", "planningHorizonDays"], additionalProperties: false }, {
        validate: input => { try { return { success: true, value: parseAgent(input) }; } catch (error) { return { success: false, error: error as Error }; } },
      }),
      execute: async value => {
        const input = parseAgent(value), link = AGENT_LINKS[input.agent];
        if (options.edition === "standard" && (!["publish", "stats"].includes(input.agent) || input.agent === "stats" && input.themes?.includes("mails"))) return { ok: false, status: "not_included", link, message: "Cette configuration nécessite Premium. Les réglages existants restent conservés." };
        if (!hasAgentInstruction(options.currentUserMessage, input)) return { ok: false, status: "instruction_required", link, message: "Demandez une instruction actuelle explicite pour cet agent ; une question d’aide ou un ancien échange n’autorise pas sa modification." };
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        if (!operations.has(fingerprint)) operations.set(fingerprint, (async () => {
          await assertScope();
          const { GET, POST } = await import("@/app/api/agent/settings/route");
          const response = await GET(trustedRequest(options.request)), data = await payload(response);
          if (!response.ok || data.tableMissing || !Object.keys(record(data.settings)).length) return { ok: false, status: "unavailable", link, message: "Les réglages actuels n’ont pas pu être vérifiés. Aucun nouvel enregistrement n’a été lancé." };
          const before = sanitizeInrAgentSettings(data.settings as Partial<InrAgentSettings>), current = before.automations[input.agent];
          if (record(current.metadata[MARKER]).id === options.actionRequestId) return { ok: true, status: "previous_attempt_recorded", link, settings: summary(before, input.agent), message: "Cette demande a déjà été enregistrée. Vérifiez son état dans l’agent ; sa préparation n’est pas relancée." };
          if (input.enabled === true && !current.enabled && !input.schedule) return { ok: false, status: "schedule_required", link, settings: summary(before, input.agent), message: "Précisez la fréquence, les jours/dates et l’heure dans le fuseau affiché avant l’activation." };
          if (input.schedule && input.schedule.timezone !== before.timezone) return { ok: false, status: "timezone_confirmation_required", link, message: "Le fuseau est partagé par les agents. Ajustez-le dans les réglages de l’agent avant cette modification ciblée.", currentTimezone: summary(before, input.agent).timezone };
          const next = { ...current, metadata: { ...current.metadata }, ...(input.enabled == null ? {} : { enabled: input.enabled }),
            ...(input.channels == null ? {} : { allowedChannels: [...input.channels] }), ...(input.themes == null ? {} : { allowedThemes: [...input.themes] }),
            ...(input.recipientScope == null ? {} : { recipientScope: input.recipientScope }), ...(input.validationMode == null ? {} : { validationMode: input.validationMode }),
            ...(input.preferredMediaSource == null ? {} : { preferredMediaSource: input.preferredMediaSource }), ...(input.planningHorizonDays == null ? {} : { planningHorizonDays: input.planningHorizonDays }) };
          if (input.schedule) {
            next.frequency = input.schedule.frequency;
            delete next.metadata.scheduleSlots; delete next.metadata.monthDays;
            if (inrAgentMonthlyDateCount(input.schedule.frequency)) { next.time = input.schedule.time!; next.metadata.monthDays = [...input.schedule.monthDays!].sort((a, b) => a - b); }
            else { const slots = input.schedule.slots!; next.dayOfWeek = slots[0].dayOfWeek; next.time = slots[0].time; if (slots.length > 1) next.metadata.scheduleSlots = slots.map(slot => ({ ...slot })); }
          }
          const automations = { ...before.automations, [input.agent]: next };
          const activeKeys = options.edition === "standard" ? ["publish", "stats"] as const : INR_AGENT_AUTOMATION_KEYS;
          const globalEnabled = activeKeys.some(key => automations[key].enabled);
          const desired = sanitizeInrAgentSettings({ ...before, automations, globalEnabled, enabled: globalEnabled });
          if (sameSettings(before, desired, input.agent)) return { ok: true, status: "already_configured", link, settings: summary(before, input.agent), message: "Ces réglages sont déjà en place ; aucune nouvelle préparation n’a été déclenchée." };
          desired.automations[input.agent].metadata = { ...desired.automations[input.agent].metadata, [MARKER]: { id: options.actionRequestId, fingerprint } };
          await assertScope();
          const savedResponse = await POST(trustedRequest(options.request, { settings: desired })), saved = await payload(savedResponse);
          if (!savedResponse.ok) {
            const confirmation = saved.code === "EDITORIAL_PLAN_CHANGE_CONFIRMATION_REQUIRED", insufficient = saved.code === "EDITORIAL_PLAN_QUOTA_INSUFFICIENT";
            return { ok: false, status: confirmation ? "confirmation_required" : insufficient ? "quota_insufficient" : "save_unconfirmed", link,
              message: confirmation ? "Ces réglages touchent un planning déjà préparé. Ouvrez Réglages pour choisir et confirmer leur application." : insufficient ? "Le quota ne permet pas ce changement de planning. Les publications protégées sont conservées." : "L’enregistrement n’a pas été confirmé. Vérifiez les réglages dans l’agent avant de réessayer." };
          }
          if (saved.saved !== true || !Object.keys(record(saved.settings)).length) return { ok: false, status: "save_unconfirmed", link, message: "Vérifiez les réglages dans l’agent : le serveur n’a pas confirmé leur enregistrement." };
          const actual = sanitizeInrAgentSettings(saved.settings as Partial<InrAgentSettings>);
          return { ok: true, status: sameSettings(desired, actual, input.agent) ? "saved" : "saved_with_adjustments", link, settings: summary(actual, input.agent),
            message: "Réglages enregistrés selon les contrôles du module. Cela ne confirme pas qu’un contenu a déjà été préparé, publié ou envoyé." };
        })().catch(error => {
          if (error instanceof ManagementInputError) throw error;
          return { ok: false, status: "operation_unconfirmed", link, message: "L’opération n’a pas pu être confirmée. Vérifiez son état dans les réglages avant toute nouvelle tentative." };
        }));
        return operations.get(fingerprint)!;
      },
    }),
  };
}
