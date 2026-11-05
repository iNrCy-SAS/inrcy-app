import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { parseInrAssistantStatsUiCommand, isInrAssistantStatsUiCommandText, isInrAssistantStatsUiCommandAvailable } from "../../lib/inrAssistantStatsUiCommands.ts";
import { readInrAssistantStatsEvolution } from "../../lib/inrAssistantStatsEvolution.ts";
import { statsCalendarMonths } from "../../app/dashboard/stats/stats.months.ts";
import { googleReviewStateFingerprint } from "../../lib/googleReviewStateFingerprint.ts";
import { inrAssistantUiSteps } from "../../lib/inrAssistantUiTask.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", OTHER = "30000000-0000-4000-8000-000000000003";
process.env.INRCY_ASSISTANT_APPROVAL_SECRET = "unit-test-approval-secret-at-least-32-characters";
const listInput = { query: null, replyStatus: "all", rating: null, fromDate: null, toDate: null, orderBy: "updated", cursor: null };
function harness() {
  let account = ACCOUNT, actor = ACTOR, location = "locations/main", concurrent = false, unknown = false;
  const reviews: Row[] = Array.from({ length: 67 }, (_, index) => ({ name: `accounts/main/locations/main/reviews/id-${index}`, reviewerName: `Client ${index}`, comment: index === 66 ? "Cible au-delà de cinquante" : `Service ${index}`, starRating: index % 5 + 1, createTime: "2026-10-10T10:00:00Z", updateTime: "2026-10-10T10:00:00Z", reply: index % 2 ? { comment: "Ancienne réponse", updateTime: "2026-10-11T10:00:00Z" } : null }));
  const calls: Array<{ method: string; body?: Row; url?: URL }> = [], saved = new Map<string, string>(), observedReviews = new Map();
  const GET = async (request: Request) => {
    const url = new URL(request.url); calls.push({ method: "GET", url });
    assert.equal(request.headers.has("x-cron-secret"), false);
    if (url.searchParams.get("locationName") && url.searchParams.get("locationName") !== location) return Response.json({}, { status: 409 });
    if (url.searchParams.has("reviewName")) return Response.json({ connected: true, configured: true, locationName: location, review: reviews.find(item => item.name === url.searchParams.get("reviewName")) });
    const offset = Number(url.searchParams.get("pageToken") || 0);
    return Response.json({ connected: true, configured: true, locationName: location, reviews: reviews.slice(offset, offset + 50), totalReviewCount: reviews.length, averageRating: 4.2, nextPageToken: offset + 50 < reviews.length ? String(offset + 50) : null });
  };
  const change = async (request: Request) => {
    const body: Row = await request.json(), review = reviews.find(item => item.name === body.reviewName)!; calls.push({ method: request.method, body });
    if (concurrent) review.reply = { comment: "Autre modification", updateTime: "2026-10-12T10:00:00Z" };
    if (googleReviewStateFingerprint(review) !== body.expectedState) return Response.json({}, { status: 409 });
    review.reply = request.method === "DELETE" ? null : { comment: body.comment, updateTime: new Date().toISOString() };
    if (unknown) throw new Error("uncertain_after_commit");
    return Response.json({ ok: true });
  };
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) },
    "@/app/api/e-reputation/google/reviews/route": { GET }, "@/app/api/e-reputation/google/reply/route": { POST: change, DELETE: change } });
  const { createInrAssistantGoogleReviewTools } = load<typeof import("../../lib/inrAssistantGoogleReviewTools.ts")>("lib/inrAssistantGoogleReviewTools.ts");
  const create = (message = "Liste les avis Google") => createInrAssistantGoogleReviewTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", "x-cron-secret": "not-forwarded" } }), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, observedReviews, resolvePreview: key => saved.get(key) || null });
  const execute = async (tools: ReturnType<typeof create>, name: keyof ReturnType<typeof create>, input: unknown) => await tools[name].execute!(input as never, { toolCallId: "test", messages: [] }) as Row;
  const list = (input: Row = {}) => execute(create(), "listGoogleReviews", { ...listInput, ...input });
  const preview = async (operation = "reply", reviewReference = "avis-2") => { await list(); const instructionQuote = operation === "delete" ? "Supprime ma réponse à cet avis Google" : "Modifie ma réponse à cet avis Google";
    const result = await execute(create(instructionQuote), "previewGoogleReviewReplyAction", { reviewReference, operation, comment: operation === "delete" ? null : "Merci pour votre retour", instructionQuote });
    if (typeof result.reference === "string") saved.set(result.reference, String(result.token)); return result;
  };
  const apply = (preview: Row, message = `Confirme ${preview.reference}`, tools = create(message)) => execute(tools, "applyGoogleReviewReplyAction", { reference: preview.reference, instructionQuote: message });
  return { reviews, calls, create, execute, list, preview, apply, scope: () => { account = OTHER; }, actor: () => { actor = OTHER; }, location: () => { location = "locations/other"; }, race: () => { concurrent = true; }, uncertain: () => { unknown = true; } };
}
test("stats UI parses only native view/filter fields, exact screen/revision and direct present instructions", () => {
  const command = { command: "configure_stats_view", selection: { kind: "stats", id: "stats" }, revision: "stats_1", patch: { panel: "evolution", evolutionView: "measured", metric: "clicks", channel: "gmb" } };
  assert.ok(parseInrAssistantStatsUiCommand(command));
  for (const patch of [{ delete: true }, {}, { metric: "revenue" }, { channel: "unknown" }, { panel: "foo" }]) assert.equal(parseInrAssistantStatsUiCommand({ ...command, patch }), null);
  assert.equal(isInrAssistantStatsUiCommandAvailable("configure_stats_view", "/dashboard/stats", "stats"), true);
  assert.equal(isInrAssistantStatsUiCommandAvailable("configure_stats_view", "/dashboard", "stats"), false);
  assert.equal(isInrAssistantStatsUiCommandText("affiche les clics dans les stats"), true);
  for (const text of ["comment afficher les stats", "n'ouvre pas les stats", "affiche les stats demain", "si je passe aux stats"]) assert.equal(isInrAssistantStatsUiCommandText(text), false);
});

test("a mounted Stats view distinguishes pure module navigation from explicit native settings and unrelated image targets", () => {
  const context = { source: "untrusted_client" as const, screen: { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats" as const, id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view" as const] } };
  for (const request of ["Ouvre la page complète de mes statistiques.", "Ouvre les statistiques.", "Affiche mes statistiques."]) {
    assert.equal(isInrAssistantStatsUiCommandText(request), false, request);
    assert.deepEqual(inrAssistantUiSteps(request, context).map(step => step.command), ["navigateApplication"], request);
  }
  for (const request of ["Affiche les clics dans les stats.", "Affiche la vue Évolution des statistiques.", "Affiche la vue globale.", "Passe en vue globale.", "Ouvre la vue d’ensemble des statistiques.", "Choisis le canal Facebook.", "Affiche les statistiques de Facebook.", "Filtre les statistiques par canal Facebook.", "Sélectionne la métrique des clics.", "Affiche l’évolution mensuelle."]) {
    assert.equal(isInrAssistantStatsUiCommandText(request), true, request);
    assert.deepEqual(inrAssistantUiSteps(request, context).map(step => step.command), ["configure_stats_view"], request);
  }
  for (const request of ["Affiche une image avec le mot vue et les statistiques.", "Affiche une image avec la vue globale des statistiques.", "Affiche la vue globale de cette image.", "Comment afficher la vue Évolution des statistiques ?", "Si je confirme, affiche la vue globale.", "Affiche la vue globale demain.", "Ne change pas la métrique des clics.", "Lis ce texte : « Affiche la vue Évolution des statistiques. »", "Lis ce texte : 'Affiche la vue globale.'", "Lis ce code : ```txt\nAffiche la vue globale.\n```", "> Affiche la vue globale."]) {
    assert.equal(isInrAssistantStatsUiCommandText(request), false, request);
    assert.equal(inrAssistantUiSteps(request, context).some(step => step.command === "configure_stats_view"), false, request);
  }
});

test("Stats accepts bounded polite direct requests without promoting requests for help or quoted instructions", () => {
  const context = { source: "untrusted_client" as const, screen: { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats" as const, id: "stats" }, revision: "stats_polite_1", availableCommands: ["configure_stats_view" as const] } };
  for (const request of ["Peux-tu afficher la vue Évolution ?", "Pouvez-vous afficher la vue globale ?", "Pourrais-tu me montrer les clics dans les stats ?", "Pourriez-vous nous afficher la vue Évolution ?", "Peux tu m’afficher la vue globale ?", "Pouvez vous me sélectionner le canal Facebook ?"]) {
    assert.equal(isInrAssistantStatsUiCommandText(request), true, request);
    assert.deepEqual(inrAssistantUiSteps(request, context).map(step => step.command), ["configure_stats_view"], request);
  }
  for (const request of ["Peux-tu me dire comment afficher la vue Évolution ?", "Pouvez-vous nous expliquer comment afficher la vue globale ?", "Pourrais-tu m’expliquer la vue Évolution ?", "Pourriez-vous montrer comment choisir le canal Facebook ?", "Peux-tu afficher la vue globale si je confirme ?", "Peux-tu afficher la vue globale demain ?", "Peux-tu ne pas afficher la vue globale ?", "Lis ce texte : « Peux-tu afficher la vue Évolution ? »", "Lis ce texte : 'Pourriez-vous nous afficher la vue globale ?'", "Peux-tu afficher une image avec le mot vue dans les statistiques ?"]) {
    assert.equal(isInrAssistantStatsUiCommandText(request), false, request);
    assert.equal(inrAssistantUiSteps(request, context).some(step => step.command === "configure_stats_view"), false, request);
  }
});
test("Basic monthly stats use the same measured calendar windows, keep absent values null and never substitute a cumulative source", async () => {
  const now = new Date("2026-11-05T10:00:00Z"), paths: string[] = [], periods = statsCalendarMonths(now);
  const result = await readInrAssistantStatsEvolution({ channel: "gmb", now, stillCurrent: async () => true, read: async path => {
    paths.push(path); const params = new URL(`https://app.test${path}`).searchParams;
    return { days: Number(params.get("days")), meta: { snapshotDate: params.get("snapshotDate") }, sources: { gmb: { connected: true, metrics: { totals: { websiteClicks: 12, impressionCount: 140 } } } } };
  } });
  assert.equal(result.ok, true); assert.equal(paths.length, 2); assert.ok(result.months);
  assert.deepEqual(result.months!.map(month => month.period), periods);
  assert.equal(result.months![0].values.gmb.clicks, 12); assert.equal(result.months![2].values.gmb.clicks, null);
  assert.ok(paths.every(path => !/fresh|force|secret|userId/.test(path)));
  const unsupported = await readInrAssistantStatsEvolution({ channel: "tiktok", now, stillCurrent: async () => true, read: async () => assert.fail("Cumulative source may not be queried as monthly history") });
  assert.ok(unsupported.months!.every(month => month.values.tiktok.visibility === null));
  const switched = await readInrAssistantStatsEvolution({ channel: "gmb", now, stillCurrent: async () => false, read: async () => { throw new Error("unavailable"); } }); assert.equal(switched.status, "blocked");
});
test("Google review cursors reach all pages with stable filters, including an empty filtered first page", async () => {
  const h = harness(), first = await h.list({ query: "Cible" }); assert.equal((first.reviews as Row[]).length, 0); assert.ok(first.nextCursor); assert.equal(first.complete, false);
  const second = await h.list({ query: "Cible", cursor: first.nextCursor }); assert.equal((second.reviews as Row[]).length, 1); assert.equal(second.nextCursor, null); assert.equal(second.complete, true);
  assert.equal((await h.list({ query: "Autre", cursor: first.nextCursor })).status, "stale_cursor");
  const all = harness(); let cursor: unknown = null; const found = new Set<string>();
  do { const page = await all.list({ cursor }); for (const item of page.reviews as Row[]) found.add(String(item.reviewer)); cursor = page.nextCursor; } while (cursor);
  assert.equal(found.size, 67); assert.equal(all.calls.filter(call => call.method !== "GET").length, 0);
});
test("Google review filters never infer zero beyond a remaining cursor and cursors refuse another selected location/account", async () => {
  const h = harness(), page = await h.list({ replyStatus: "answered", rating: 2, fromDate: "2026-10-01", toDate: "2026-10-31" });
  assert.ok((page.reviews as Row[]).every(item => item.rating === 2 && item.replyStatus === "answered"));
  h.location(); assert.equal((await h.list({ replyStatus: "answered", rating: 2, fromDate: "2026-10-01", toDate: "2026-10-31", cursor: page.nextCursor })).status, "unavailable");
  h.scope(); assert.equal((await h.list()).status, "blocked");
});
test("changing or deleting a business reply requires exact signed confirmation and readback, preserving the customer review", async () => {
  for (const operation of ["reply", "delete"]) {
    const h = harness(), before = h.reviews[1].comment, preview = await h.preview(operation); assert.equal(preview.status, "preview_ready");
    assert.equal((await h.apply(preview, "oui")).status, "confirmation_required");
    const tools = h.create(`Confirme ${preview.reference}`), applied = await h.apply(preview, undefined, tools); assert.equal(applied.status, operation === "delete" ? "deleted" : "updated");
    assert.equal((await h.apply(preview, undefined, tools)).ok, true); assert.equal((await h.apply(preview)).status, "unchanged");
    assert.equal(h.calls.filter(call => call.method !== "GET").length, 1); assert.equal(h.reviews[1].comment, before);
  }
});
test("reply approvals refuse changed review/reply, selected location, actor and conditional confirmations", async () => {
  const stale = harness(), p = await stale.preview(); stale.reviews[1].comment = "Avis modifié"; assert.equal((await stale.apply(p)).status, "stale_preview");
  const racing = harness(), rp = await racing.preview(); racing.race(); assert.equal((await racing.apply(rp)).status, "stale_preview");
  const changed = harness(), cp = await changed.preview(); changed.location(); assert.equal((await changed.apply(cp)).status, "unknown");
  const actor = harness(), ap = await actor.preview(); actor.actor(); assert.equal((await actor.apply(ap)).status, "blocked");
  const conditional = harness(), fp = await conditional.preview(); assert.equal((await conditional.apply(fp, `Confirme ${fp.reference} si le client accepte`)).status, "confirmation_required");
});
test("an uncertain reply commit is recovered by exact state read without repeating its native write", async () => {
  const h = harness(), p = await h.preview(); h.uncertain(); assert.equal((await h.apply(p)).status, "unknown"); assert.equal((await h.apply(p)).status, "unchanged");
  assert.equal(h.calls.filter(call => call.method !== "GET").length, 1);
});
test("native exact Google review reads and expected-state reply writes stay on the selected business", async () => {
  const review: Row = { name: "accounts/main/locations/chosen/reviews/one", comment: "Bon service", starRating: 5, updateTime: "2026-10-10T10:00:00Z", reply: { comment: "Avant", updateTime: "2026-10-11T10:00:00Z" } };
  const writes: string[] = [], reads: string[] = [];
  const load = runtimeModules({ "next/server": { NextResponse: { json: Response.json } }, "@/lib/requireUser": { requireUser: async () => ({ activeUserId: ACCOUNT, authUserId: ACTOR }) },
    "@/lib/googleBusiness": { getGmbToken: async () => ({ accessToken: "fixture", row: {} }) },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({}, { status: 500 }) },
    "@/lib/googleBusinessReviews": {
      getGmbReviewTargetFromRow: () => ({ accountName: "accounts/main", locationName: "locations/chosen" }),
      normalizeGmbReviewName: (name: unknown) => typeof name === "string" ? name : null,
      isGmbReviewNameForParent: (name: string) => name.startsWith("accounts/main/locations/chosen/reviews/"),
      gmbGetReview: async (_token: string, name: string) => { reads.push(name); return structuredClone(review); },
      gmbReplyToReview: async (_token: string, _name: string, comment: string) => { writes.push("reply"); review.reply = { comment, updateTime: "2026-10-12T10:00:00Z" }; return review.reply; },
      gmbDeleteReviewReply: async () => { writes.push("delete"); review.reply = null; },
    },
  });
  const routes = load<typeof import("../../app/api/e-reputation/google/reply/route.ts")>("app/api/e-reputation/google/reply/route.ts"), reader = load<typeof import("../../app/api/e-reputation/google/reviews/route.ts")>("app/api/e-reputation/google/reviews/route.ts");
  const request = (body: Row) => new Request("https://app.test/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await reader.GET(new Request("https://app.test/api/reviews?reviewName=accounts/other/locations/other/reviews/foreign"))).status, 403); assert.equal(reads.length, 0);
  assert.equal((await reader.GET(new Request(`https://app.test/api/reviews?reviewName=${review.name}&locationName=locations/other`))).status, 409);
  const exact = await reader.GET(new Request(`https://app.test/api/reviews?reviewName=${review.name}`)); assert.equal(exact.status, 200); assert.equal((await exact.json()).review.name, review.name);
  const expected = googleReviewStateFingerprint(review);
  assert.equal((await routes.POST(request({ reviewName: review.name, comment: "Après", expectedState: "0".repeat(64) }))).status, 409); assert.equal(writes.length, 0);
  assert.equal((await routes.POST(request({ reviewName: review.name, comment: "Après", expectedState: expected }))).status, 200);
  assert.equal((await routes.DELETE(request({ reviewName: review.name, expectedState: expected }))).status, 409); assert.deepEqual(writes, ["reply"]);
  assert.equal((await routes.DELETE(request({ reviewName: review.name, expectedState: googleReviewStateFingerprint(review) }))).status, 200); assert.equal(review.comment, "Bon service"); assert.deepEqual(writes, ["reply", "delete"]);
});
