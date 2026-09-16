import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS,
  acceptCompleteAiMediaVisibleCopy,
  collectAiMediaProtectedTerms,
  preservesAiMediaProtectedTerms,
} from "../../lib/aiMediaTextIntegrity.ts";

test("les noms propres multi-mots deviennent des termes atomiques obligatoires", () => {
  const properName = "La Celle Dunoise";
  const terms = collectAiMediaProtectedTerms({
    request: {
      idea: `Permis de construire pour un bâtiment agricole à ${properName}`,
      aiInstruction: "",
      textKeywords: [],
    },
    profile: {
      business: {
        companyName: "Baticad 3D", city: properName, postalCode: "", phone: "", email: "",
        sectorCode: "", sectorLabel: "Bâtiment", professionCode: "",
        professionLabel: "Conception de bâtiments", description: "", services: [],
        interventionZones: [properName], openingDays: "", openingHours: "",
        strengths: [], customerTypologies: [],
      },
    },
  });

  assert.deepEqual(terms, [properName]);
  assert.equal(preservesAiMediaProtectedTerms(`Permis à ${properName}`, terms), true);
  assert.equal(preservesAiMediaProtectedTerms("Permis à La Celle", terms), false);
  assert.equal(preservesAiMediaProtectedTerms("Permis à La celle dunoise", terms), false);
});

test("un texte visible est validé en entier ou rejeté, jamais raccourci", () => {
  const complete = "Permis de construire pour un bâtiment agricole à La Celle Dunoise";
  assert.equal(
    acceptCompleteAiMediaVisibleCopy(complete, AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS),
    complete,
  );
  assert.equal(
    acceptCompleteAiMediaVisibleCopy(`${complete} avec une formulation trop longue `.repeat(3), 120),
    "",
  );
  assert.equal(acceptCompleteAiMediaVisibleCopy("Permis à La Celle…", 120), "");
  assert.equal(acceptCompleteAiMediaVisibleCopy("Permis de construire pour", 120), "");
});
