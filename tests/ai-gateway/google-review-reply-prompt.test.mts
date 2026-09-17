import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AI_FEATURE_POLICIES } from "../../lib/aiGatewayPolicy.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import {
  buildGoogleReviewReplyPrompt,
  GOOGLE_REVIEW_REPLY_PROMPT_MAX_CHARS,
  GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS,
  GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA,
} from "../../lib/googleReviewReplyPrompt.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function repeated(label: string, length: number) {
  return `${label}:${"x".repeat(length)}`;
}

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1;
}

test("Google review replies use the compact directive and a strict reply_text schema", () => {
  const route = read("app/api/e-reputation/google/generate-reply/route.ts");

  assert.match(route, /buildCompactAiWritingDirective\(/);
  assert.doesNotMatch(route, /buildAiWritingProfileRules/);
  assert.match(route, /responseSchema: GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA/);

  assert.equal(GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA.strict, true);
  assert.equal(GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA.schema.additionalProperties, false);
  assert.deepEqual(GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA.schema.required, ["reply_text"]);
  assert.doesNotThrow(() => {
    assertAiJsonMatchesSchema(
      { reply_text: "Merci pour votre retour." },
      GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA.schema,
    );
  });
  assert.throws(() => {
    assertAiJsonMatchesSchema(
      { comment: "Ancien format" },
      GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA.schema,
    );
  }, /reply_text/);
});

test("Google review prompt sends language, writing directive and profile only once", () => {
  const prompt = buildGoogleReviewReplyPrompt({
    company: "Entreprise test",
    locationTitle: "Fiche test",
    aiConfig: "PROFILE_SENTINEL",
    aiDirective: "DIRECTIVE_SENTINEL",
    aiLanguageInstruction: "LANGUAGE_SENTINEL",
    openingVariant: "ouverture",
    toneVariant: "ton",
    closingVariant: "clôture",
    signatureInstruction: "signature",
    reviewerName: "Client",
    rating: 5,
    reviewComment: "Très bonne expérience.",
  });
  const completePrompt = `${prompt.system}\n${prompt.input}`;

  assert.equal(countOccurrences(completePrompt, "LANGUAGE_SENTINEL"), 1);
  assert.equal(countOccurrences(completePrompt, "DIRECTIVE_SENTINEL"), 1);
  assert.equal(countOccurrences(completePrompt, "PROFILE_SENTINEL"), 1);
  assert.doesNotMatch(prompt.input, /Instruction de langue prioritaire/);
});

test("Google review worst-case prompt remains below the 16k Gateway policy", () => {
  const prompt = buildGoogleReviewReplyPrompt({
    company: repeated("COMPANY", 400),
    locationTitle: repeated("LOCATION", 400),
    city: repeated("CITY", 200),
    sectorLabel: repeated("SECTOR", 300),
    profession: repeated("PROFESSION", 300),
    activityDescription: repeated("DESCRIPTION", 2_000),
    services: Array.from({ length: 20 }, (_, index) => repeated(`SERVICE_${index}`, 200)),
    strengths: Array.from({ length: 20 }, (_, index) => repeated(`STRENGTH_${index}`, 200)),
    aiConfig: repeated("AI_CONFIG", 6_000),
    aiDirective: Array.from({ length: 80 }, (_, index) => repeated(`RULE_${index}`, 100)).join("\n"),
    aiLanguageInstruction: repeated("LANGUAGE", 1_000),
    openingVariant: repeated("OPENING", 500),
    toneVariant: repeated("TONE", 500),
    closingVariant: repeated("CLOSING", 500),
    signatureInstruction: repeated("SIGNATURE", 700),
    reviewerName: repeated("REVIEWER", 300),
    rating: 5,
    reviewComment: repeated("REVIEW", 4_000),
    existingReply: repeated("EXISTING", 4_000),
  });
  const totalChars = prompt.system.length + prompt.input.length;
  const gatewayLimit = AI_FEATURE_POLICIES["reviews.google"].maxInputChars;

  assert.equal(GOOGLE_REVIEW_REPLY_PROMPT_MAX_CHARS, gatewayLimit);
  assert.ok(totalChars <= GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS, `${totalChars} > target`);
  assert.ok(totalChars < gatewayLimit, `${totalChars} >= policy ${gatewayLimit}`);
  assert.match(prompt.input, /REVIEW:/);
  assert.match(prompt.input, /AI_CONFIG:/);
});
