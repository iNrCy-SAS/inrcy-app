import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `${start} doit etre present`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `${end} doit suivre ${start}`);
  return source.slice(startIndex, endIndex);
}

function executableSql(source: string) {
  return source
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("le contrat v3 est refuse avant toute reservation de quota", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  const versionCheck = route.indexOf("assertDraftContractVersion(requestBody)");
  const reservation = route.indexOf("reserveAiMediaGeneration({");

  assert.ok(versionCheck >= 0);
  assert.ok(reservation > versionCheck);
  assert.match(route, /inrcy-ai-media-generation-v9-omni-veo-controlled-voiceover/);
  assert.match(route, /draft:\s*true/);
});

test("un resultat reussi reste un brouillon prive jusqu'a l'acceptation", () => {
  const registry = read("lib/aiGeneratedMediaRegistry.ts");
  const saveDraft = section(
    registry,
    "export async function saveGeneratedAiMediaDraft",
    "/**\n * Promotion idempotente",
  );
  const acceptDraft = section(
    registry,
    "export async function acceptGeneratedAiMediaDraft",
    "export type GeneratedAiMediaDraftDiscardOutcome",
  );

  assert.match(saveDraft, /source:\s*GENERATED_DRAFT_SOURCE/);
  assert.match(saveDraft, /is_active:\s*false/);
  assert.doesNotMatch(saveDraft, /enqueueLibraryNormalization\(/);

  assert.match(acceptDraft, /source:\s*GENERATED_SOURCE/);
  assert.match(acceptDraft, /is_active:\s*true/);
  assert.match(acceptDraft, /enqueueLibraryNormalization\(/);
});

test("refuser un brouillon supprime Storage et registre sans toucher au quota", () => {
  const registry = read("lib/aiGeneratedMediaRegistry.ts");
  const discardDraft = section(
    registry,
    "export async function discardGeneratedAiMediaDraft",
    "export async function purgeExpiredGeneratedAiMediaDrafts",
  );
  const discardRoute = read("app/api/media-generation/drafts/[id]/route.ts");

  assert.match(discardDraft, /isAcceptedGeneratedMedia\(existing\)/);
  assert.match(discardDraft, /GENERATED_DRAFT_SOURCE/);
  assert.match(discardDraft, /\.storage\.from\(bucket\)\.remove\(\[storagePath\]\)/);
  assert.match(discardDraft, /\.from\("pro_media_library"\)[\s\S]*?\.delete\(\)/);
  assert.doesNotMatch(discardDraft, /used_count|reserved_count|failAiMediaGeneration/);
  assert.match(discardRoute, /getCurrentInrcyAccountScope\(\)/);
  assert.match(discardRoute, /current\.scope\.activeUserId/);
});

test("la validation est scopee au compte actif et idempotente", () => {
  const route = read("app/api/media-generation/drafts/[id]/accept/route.ts");
  const registry = read("lib/aiGeneratedMediaRegistry.ts");

  assert.match(route, /getCurrentInrcyAccountScope\(\)/);
  assert.match(route, /current\.scope\.activeUserId/);
  assert.match(registry, /if \(isAcceptedGeneratedMedia\(existing\)\)/);
  assert.match(
    registry,
    /\.eq\("user_id", args\.accountId\)[\s\S]*?\.eq\("source", GENERATED_DRAFT_SOURCE\)/,
  );
  assert.match(registry, /buildMediaLibraryContentUrl/);
  assert.match(registry, /isAcceptedGeneratedMedia\(row\)/);
});

test("une coupure apres generation rejoue le meme media sans regenerer", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const booster = read("app/dashboard/booster/publier/PublishModal.tsx");
  const acceptDraft = section(
    hook,
    "const acceptDraft = useCallback",
    "const discardDraft = useCallback",
  );
  const mediaDownload = section(
    booster,
    "async function mediaLibraryItemToFile",
    "const addMediaLibrarySelection",
  );

  assert.match(acceptDraft, /DRAFT_ACCEPT_RETRY_DELAYS_MS/);
  assert.match(acceptDraft, /mediaDraftEndpoint\(requested\.item\.id\)/);
  assert.doesNotMatch(acceptDraft, /\/api\/media-generation\/generate/);
  assert.match(mediaDownload, /retryDelaysMs/);
  assert.match(mediaDownload, /cache:\s*"no-store"/);
  assert.match(mediaDownload, /sans le régénérer/);
});

test("la fermeture et la regeneration detruisent le brouillon avant de continuer", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const regenerate = section(
    generator,
    "const handleGenerate = async () =>",
    "const handleConfirm = async () =>",
  );
  const confirm = section(
    generator,
    "const handleConfirm = async () =>",
    "const subjectChoices",
  );

  assert.match(hook, /\/api\/media-generation\/drafts\/\$\{encodeURIComponent\(mediaId\)\}/);
  assert.ok(regenerate.indexOf("await discardDraft") < regenerate.indexOf("await generate"));
  assert.ok(confirm.indexOf("await acceptDraft") < confirm.indexOf("await onAccepted"));
  assert.match(modal, /role="alertdialog"/);
  assert.match(modal, /await discardMediaGenerationDraft/);
  assert.match(modal, /beforeunload/);
});

test("la purge 24 h est branchee au cron horaire", () => {
  const registry = read("lib/aiGeneratedMediaRegistry.ts");
  const cron = read("app/api/cron/media-orphan-cleanup/route.ts");
  const vercel = JSON.parse(read("vercel.json")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.match(registry, /GENERATED_DRAFT_TTL_MS = 24 \* 60 \* 60 \* 1_000/);
  assert.match(cron, /purgeExpiredGeneratedAiMediaDrafts/);
  assert.ok(
    vercel.crons?.some(
      (entry) =>
        entry.path === "/api/cron/media-orphan-cleanup" &&
        entry.schedule === "17 * * * *",
    ),
  );
});

test("la migration temporaire est additive et son postflight est read only", () => {
  const migration = read(
    "ops/sql/2026-08-31_ai_media_generation_temporary_drafts.sql",
  );
  const postflight = read(
    "ops/sql/2026-08-31_ai_media_generation_temporary_drafts_postflight_read_only.sql",
  );
  const sql = executableSql(migration);

  assert.doesNotMatch(sql, /\bdrop\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\balter\s+table[\s\S]*?\bdrop\b/i);
  assert.match(sql, /create index if not exists pro_media_library_ai_draft_expiration_idx/i);
  assert.match(sql, /ai_media_complete_temporary_draft_quota/i);
  assert.match(sql, /temporary_draft_created/i);
  assert.match(sql, /prompt_sha256/i);
  assert.doesNotMatch(sql, /new\.media_metadata[\s\S]*?->>\s*'idea'/i);
  assert.match(postflight, /begin transaction read only/i);
  assert.match(postflight, /'PASS'/);
});

test("le brief libre ne persiste pas dans le registre du media", () => {
  const server = read("lib/aiMediaGenerationServer.ts");
  const persistence = section(
    server,
    'const item = await measure("media_persistence"',
    "return {\n    item,",
  );

  assert.doesNotMatch(persistence, /idea:\s*args\.request\.idea/);
  assert.doesNotMatch(persistence, /prompt:\s*prompt/);
  assert.match(persistence, /prompt_sha256:\s*promptHash/);
});
