import assert from "node:assert/strict";
import test from "node:test";
import { auditAiMediaNativeDialogueClips, type AiMediaNativeDialogueQaClip } from "../../lib/aiMediaNativeDialogueQa.ts";

const expectedLine = "Notre société NovaDesk ne comprend pas la livraison et propose cette offre à 50 euros seulement.";
const first = expectedLine.replace("50", "500");
const second = expectedLine.replace("50", "5000");
const different = expectedLine.replace("50", "50000");
const clip: AiMediaNativeDialogueQaClip = { sceneIndex: 0, buffer: Buffer.from("offline-synthetic-clip"), durationSeconds: 8, expectedLine };

function fixture(reads: Array<string | Error>, signal?: AbortSignal) {
  let calls = 0;
  const listen = async (_clip: typeof clip, options: { language: string; signal?: AbortSignal }) => {
    assert.deepEqual(Object.keys(options).sort(), ["language", "signal"]);
    assert.equal(options.signal, signal);
    assert.ok(calls < 4, "At most four audio checks can be purchased for one clip");
    const text = reads[calls++]; assert.ok(text !== undefined, "No unplanned audio check");
    if (text instanceof Error) throw text;
    return { text };
  };
  return { calls: () => calls, run: () => auditAiMediaNativeDialogueClips({
    clips: [clip], signal, transcribe: listen, confirm: listen,
    verifyPronunciation: async () => { assert.fail("The four-read path cannot purchase a fifth phonetic check"); },
  }) };
}

test("two fresh passing reads resolve two earlier contradictory rejected reads without changing dialogue comparison", async () => {
  const h = fixture([first, second, expectedLine, expectedLine]); const result = await h.run();
  assert.equal(result.status, "passed"); assert.equal(h.calls(), 4);
  assert.equal(result.clips[0].audioCheckCount, 4);
  assert.equal(result.clips[0].confirmationDecision, "conflicting_reads_confirmed_pass");
  assert.deepEqual(result.clips[0].readOutcomes?.map(read => read.status), ["rejected", "rejected", "passed", "passed"]);
  assert.deepEqual(result.clips[0].issues, []);
  assert.doesNotMatch(JSON.stringify(result), /NovaDesk|livraison|500|offline-synthetic/);
});

test("one favorable third read never authorizes delivery after conflicting amounts, negations or names", async () => {
  for (const last of [first, second, expectedLine.replace("ne comprend pas", "comprend"), expectedLine.replace("NovaDesk", "SuperCloud"), "", new DOMException("PRIVATE_DEADLINE", "TimeoutError")]) {
    const h = fixture([first, second, expectedLine, last]); const result = await h.run();
    assert.equal(result.status, "unavailable"); assert.equal(h.calls(), 4);
    assert.equal(result.clips[0].confirmation, "unavailable");
    assert.equal(result.clips[0].confirmationDecision, last instanceof Error ? "confirmation_unavailable" : "conflicting_reads_unresolved");
    assert.doesNotMatch(JSON.stringify(result), /NovaDesk|SuperCloud|PRIVATE|livraison/);
  }
});

test("a third independent read can confirm one earlier defect but cannot merge different defects", async () => {
  for (const third of [first, second, different]) {
    const h = fixture([first, second, third]); const result = await h.run();
    assert.equal(h.calls(), 3);
    assert.equal(result.status, third === different ? "unavailable" : "rejected");
    assert.equal(result.clips[0].confirmationDecision, third === different ? "conflicting_reads_unresolved" : "conflicting_reads_confirmed_defect");
    if (third !== different) assert.ok(result.clips[0].issues.includes("spoken_critical_value_mismatch"));
  }
});

test("a failure before the fourth listen stays unavailable and caller cancellation cannot purchase another check", async () => {
  const failed = fixture([first, second, new DOMException("PRIVATE_TRANSPORT", "TimeoutError")]);
  assert.equal((await failed.run()).status, "unavailable"); assert.equal(failed.calls(), 3);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(auditAiMediaNativeDialogueClips({ clips: [clip], signal: controller.signal,
    transcribe: async () => { calls++; return { text: first }; },
    confirm: async (_clip, { signal }) => {
      assert.equal(signal, controller.signal); calls++;
      if (calls === 3) controller.abort(new DOMException("Shared deadline", "TimeoutError"));
      return { text: calls === 2 ? second : expectedLine };
    },
  }), { name: "TimeoutError" });
  assert.equal(calls, 3);
});

test("an unavailable confirmation is not mistaken for a second rejected transcript and buys no tie-breaker", async () => {
  let calls = 0;
  const result = await auditAiMediaNativeDialogueClips({ clips: [{ ...clip, automaticDialogueContext: "A delegated original business presentation." }],
    transcribe: async () => { calls++; return { text: first }; },
    confirm: async () => { calls++; assert.equal(calls, 2); return { text: `${expectedLine} Nous accompagnons chaque client du début à la fin.` }; },
    verifyAutomaticDialogue: async () => ({ status: "unavailable" }),
  });
  assert.equal(result.status, "unavailable"); assert.equal(calls, 2);
  assert.equal(result.clips[0].confirmationDecision, "confirmation_unavailable");
});

test("every clip must reach its own independent passing pair while film order and private content stay isolated", async () => {
  const lines = [expectedLine, "Découvrez notre atelier et tous nos services pour votre entreprise."];
  const counts = [0, 0];
  const listen = async (current: typeof clip) => {
    const index = current.sceneIndex, count = counts[index]++;
    if (count === 0) return { text: index ? "Une toute autre histoire commence ici." : first };
    if (count === 1) return { text: index ? "Les mots changent pour un voyage différent." : second };
    return { text: index && count === 3 ? "Le discours final ne correspond plus." : lines[index] };
  };
  const result = await auditAiMediaNativeDialogueClips({ clips: lines.map((expectedLine, sceneIndex) => ({ ...clip, sceneIndex, expectedLine })), transcribe: listen, confirm: listen });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.clips.map(current => current.status), ["passed", "unavailable"]);
  assert.deepEqual(counts, [4, 4]);
  assert.doesNotMatch(JSON.stringify(result), /NovaDesk|atelier|discours|histoire/);
});
