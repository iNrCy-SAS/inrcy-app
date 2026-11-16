import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as contract from "../../lib/studioReferences.ts";

export const ACCOUNT = "10000000-0000-4000-8000-000000000001";
export const OTHER = "10000000-0000-4000-8000-000000000002";
export const ACTOR = "20000000-0000-4000-8000-000000000001";
export const PHOTO = "30000000-0000-4000-8000-000000000001";
export const AUDIO = "30000000-0000-4000-8000-000000000002";
export const REF = "40000000-0000-4000-8000-000000000001";
export const VOICE = "50000000-0000-4000-8000-000000000001";
export function memory(): contract.StudioReferenceMemory {
  return { version: 1, references: [{ id: REF, mediaLibraryId: PHOTO, role: "character", usage: "required", characterName: "Camille", voiceMode: "provided" }],
    voices: [{ id: VOICE, libraryMediaId: AUDIO, target: { referenceId: REF }, gender: "auto" }], activeNarrationVoiceId: null };
}
export function asset(id: string, media_type: "image" | "audio", overrides: Record<string, unknown> = {}) {
  return { id, user_id: ACCOUNT, media_type, mime_type: media_type === "image" ? "image/jpeg" : "audio/wav", title: "Private asset", original_file_name: "private-file",
    size_bytes: 100, width: null, height: null, duration_seconds: media_type === "audio" ? 7 : null, bucket_name: "inrcy-pro-media",
    storage_path: `users/${ACCOUNT}/${media_type}/2026/file.${media_type === "image" ? "jpg" : "wav"}`, is_active: true, source: "upload", ...overrides };
}
const nativeRequire = createRequire(import.meta.url);
export function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const js = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", js)(record, record.exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "./studioReferences.ts" || name === "@/lib/studioReferences") return contract;
    if (name.startsWith("node:") || name === "crypto") return nativeRequire(name);
    throw new Error(`unexpected_studio_references_dependency:${name}`);
  });
  return record.exports as T;
}
