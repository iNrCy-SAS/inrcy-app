import test from "node:test";
import assert from "node:assert/strict";

import {
  detectLikelyAiLanguage,
  hasAiLanguageMismatch,
} from "../../lib/aiLanguageValidation.ts";

const samples = {
  fr: "Nous vous accompagnons dans votre projet de jardin avec un travail soigné, des conseils utiles et un service local de qualité.",
  en: "We help you with your outdoor project and deliver careful work, useful advice, quality service and clear results for your garden.",
  es: "Le acompañamos en su proyecto de jardín con un trabajo cuidado, consejos útiles, un servicio local de calidad y resultados claros.",
  it: "Vi accompagniamo nel vostro progetto di giardino con un lavoro accurato, un servizio di qualità, consigli utili e risultati concreti.",
  de: "Wir begleiten Sie bei Ihrem Gartenprojekt mit sorgfältiger Arbeit, guter Beratung, hoher Qualität und einem lokalen Service ohne leere Versprechen.",
  nl: "Wij helpen u met uw tuinproject, zorgvuldig werk, helder advies, lokale kwaliteit en een nette dienst zonder verzonnen beloften.",
  pt: "Acompanhamos você no seu projeto de jardim com trabalho cuidadoso, conselho útil, serviço local de qualidade e resultados claros sem inventar informações.",
  th: "เราช่วยดูแลโครงการสวนของคุณด้วยงานที่พิถีพิถัน คำแนะนำที่เป็นประโยชน์ บริการในพื้นที่ที่มีคุณภาพ และผลลัพธ์ที่ชัดเจนโดยไม่แต่งข้อมูลขึ้นมา",
  zh: "我们以细致的工作、实用的建议和优质的本地服务协助您完成花园项目，并提供清晰的成果，不虚构任何信息。",
} as const;

test("language detector covers all nine iNrCy generation languages", () => {
  for (const [language, text] of Object.entries(samples)) {
    const detected = detectLikelyAiLanguage(text);
    assert.equal(detected.language, language, `${language}: ${JSON.stringify(detected)}`);
  }
});

test("same-language content is accepted for all nine languages", () => {
  for (const [language, text] of Object.entries(samples)) {
    assert.equal(hasAiLanguageMismatch(language, text), false, language);
  }
});

test("strong wrong-language output is rejected, including non-French mismatches", () => {
  assert.equal(hasAiLanguageMismatch("es", samples.en), true);
  assert.equal(hasAiLanguageMismatch("it", samples.de), true);
  assert.equal(hasAiLanguageMismatch("nl", samples.pt), true);
  assert.equal(hasAiLanguageMismatch("fr", samples.en), true);
  assert.equal(hasAiLanguageMismatch("th", samples.zh), true);
  assert.equal(hasAiLanguageMismatch("zh", samples.th), true);
});

test("short or neutral text is not rejected aggressively", () => {
  assert.equal(hasAiLanguageMismatch("es", "Jardin Horizon — Arras"), false);
  assert.equal(hasAiLanguageMismatch("de", "Terrasse 20 m² — Michel"), false);
});
