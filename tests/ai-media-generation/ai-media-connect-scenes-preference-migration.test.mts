import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const readSql = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

const original = readSql("ops/sql/2026-09-05_ai_media_generator_preferences_atomic.sql");
const migration = readSql("supabase/migrations/20260909210317_ai_media_connect_scenes_preference.sql");
const introduction = [
  "-- Add only the opt-in scene-connection preference to Finitions (stored block 6).",
  "-- Older clients may omit it; their default remains false. Existing rows are",
  "-- not rewritten. The v2 team-video wrapper, authorization, RLS and locks remain unchanged.",
  "",
].join("\n");
const strictBooleanValidation = [
  "          or (",
  "            p_defaults ? 'connectScenes'",
  "            and jsonb_typeof(p_defaults -> 'connectScenes') is distinct from 'boolean'",
  "          )",
  "",
].join("\n");
const storedBoolean =
  "          'connectScenes', coalesce((p_defaults ->> 'connectScenes')::boolean, false),\n";

test("la migration du raccord ne change que le commentaire et l'allowlist du bloc 6", () => {
  assert.equal(migration.startsWith(introduction), true);
  assert.doesNotMatch(original, /connectScenes/);
  let restoredOriginal = migration;
  for (const addition of [introduction, strictBooleanValidation, storedBoolean]) {
    assert.equal(restoredOriginal.split(addition).length - 1, 1, "chaque ajout est unique et explicite");
    restoredOriginal = restoredOriginal.replace(addition, "");
  }
  assert.equal(restoredOriginal, original, "aucune autre ligne de la RPC existante ne doit changer");
});

test("seul le bloc 6 mémorise un raccord booléen strict, absent égal à false", () => {
  const blockSix = migration.match(/      when 6 then\n([\s\S]*?)    end case;/)?.[1];
  assert.ok(blockSix);
  assert.equal(blockSix.includes(strictBooleanValidation), true, "la présence de la clé distingue null de son absence");
  assert.equal(blockSix.includes(storedBoolean), true);
  assert.match(blockSix, /errcode = '22023',[\s\S]*?message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH'/);
  assert.ok(
    blockSix.indexOf(strictBooleanValidation) < blockSix.indexOf("::boolean"),
    "le contrôle JSON strict précède tout cast permissif PostgreSQL",
  );

  const allowlist = blockSix.match(/v_defaults := jsonb_build_object\(\n([\s\S]*?)\n        \);/)?.[1];
  assert.ok(allowlist);
  assert.deepEqual(
    [...allowlist.matchAll(/^\s*'([A-Za-z]+)',/gm)].map((match) => match[1]),
    ["durationSeconds", "connectScenes", "withText", "withMusic", "withNarration", "narrationVoice"],
    "aucun média, consentement ou texte libre ne doit devenir persistable",
  );
  assert.match(blockSix, /'durationSeconds' not in \('8', '16', '24'\)/);
  const otherBlocks = migration.slice(migration.indexOf("    case p_block_id"), migration.indexOf("      when 6 then"));
  assert.doesNotMatch(otherBlocks, /connectScenes/);
});

test("la migration ne réécrit aucune donnée et conserve les écritures RPC limitées au compte autorisé", () => {
  const sql = migration.replace(/^\s*--.*$/gm, "");
  const functionBodies = [...sql.matchAll(/as \$\$([\s\S]*?)\$\$;/g)];
  assert.equal(functionBodies.length, 1, "une seule RPC existante est remplacée");
  const body = functionBodies[0][1];
  const outsideFunction = sql.replace(functionBodies[0][0], "");
  assert.doesNotMatch(outsideFunction, /\b(?:update|insert|delete|truncate|drop|alter|do|call|select)\b/i);
  assert.doesNotMatch(sql, /security definer|disable row level security/i);
  assert.match(sql, /security invoker\s+set search_path = ''/i);
  assert.match(body, /if \(select auth\.uid\(\)\) is null[\s\S]*?public\.inrcy_can_access_account\(p_account_id\)/);
  assert.match(body, /where config\.user_id = p_account_id\s+for update;/i);
  assert.equal([...body.matchAll(/\binsert into\b/gi)].length, 1);
  assert.match(body, /insert into public\.pro_tools_configs \(user_id, settings\)\s+values \(p_account_id, '\{\}'::jsonb\)\s+on conflict \(user_id\) do nothing;/i);
  assert.equal([...body.matchAll(/\bupdate public\./gi)].length, 1);
  assert.match(body, /update public\.pro_tools_configs as config\s+set settings = v_root_settings\s+where config\.user_id = p_account_id\s+returning/i);
  assert.match(body, /else\s+v_blocks := v_blocks - p_block_id::text;/, "désactiver supprime uniquement le bloc demandé");
  assert.match(sql, /revoke all on function[\s\S]*?from public, anon, authenticated, service_role;/i);
  assert.match(sql, /grant execute on function[\s\S]*?to authenticated;/i);
  assert.doesNotMatch(sql, /inrcy_patch_ai_media_generator_preferences_v2/);
});

test("la RPC v2 existante continue de transmettre le bloc 6 à la whitelist corrigée", () => {
  const wrapper = readSql("ops/sql/2026-09-05_ai_media_generator_team_video_mode.sql");
  assert.match(wrapper, /v_v1_defaults jsonb := p_defaults;/);
  assert.match(wrapper, /if p_block_id = 5 and p_saved then[\s\S]*?v_v1_defaults := jsonb_build_object\([\s\S]*?\);\s+end if;/);
  assert.equal([...wrapper.matchAll(/v_v1_defaults :=/g)].length, 1, "seul le bloc 5 adapte les valeurs avant délégation");
  assert.match(wrapper, /v_result := public\.inrcy_patch_ai_media_generator_preferences\(\s+p_account_id,\s+p_block_id,\s+p_saved,\s+v_v1_defaults\s+\);/);
});
