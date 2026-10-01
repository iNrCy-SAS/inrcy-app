import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const baseModal = read("app/dashboard/_components/WorkflowBaseModal.tsx");
const boosterLayer = read(
  "app/dashboard/_components/DashboardBoosterModalLayer.tsx",
);
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const footerActions = read(
  "app/dashboard/booster/publier/components/PublishFooterActions.tsx",
);
const dashboardStyles = read("app/dashboard/dashboard.module.css");

test("Booster Publier alone opts into the near-full-width desktop workspace", () => {
  assert.match(baseModal, /wideOnDesktop = false/);
  assert.match(
    baseModal,
    /wideOnDesktop \? styles\.fullscreenModalInnerWideDesktop : ""/,
  );
  assert.match(
    boosterLayer,
    /<BaseModal[\s\S]{0,260}?title=\{i18nT\("publier_34e6b19e"\)\}[\s\S]{0,260}?wideOnDesktop/,
  );
  assert.match(
    dashboardStyles,
    /@media \(min-width: 1181px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]{0,180}?\.fullscreenModalInnerWideDesktop \{[\s\S]{0,100}?max-width: none !important;/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 700px\)[\s\S]*?\.fullscreenModalInner \{[\s\S]*?max-width: 100%;/,
  );
});

test("the AI engine selector and generation CTA share a right-aligned responsive action row", () => {
  const actionsStart = intentPanel.indexOf(
    'data-testid="booster-ai-generation-actions"',
  );
  const actionsEnd = intentPanel.indexOf(
    "{generationMediaWarning ? (",
    actionsStart,
  );
  const actions = intentPanel.slice(actionsStart, actionsEnd);

  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart);
  assert.match(actions, /justifyContent: "flex-end"/);
  assert.match(actions, /flexWrap: "wrap"/);
  assert.match(actions, /flex: isMobile \? "1 1 100%" : "0 1 280px"/);
  assert.match(actions, /width: isMobile \? "100%" : "auto"/);
  assert.ok(actions.indexOf("<select") < actions.indexOf("styles.aiGenerateBtn"));
});

test("the intention introduction no longer duplicates the media policy in every locale", () => {
  assert.doesNotMatch(intentPanel, /getLocalizedBoosterMediaOptimization/);
  assert.match(
    intentPanel,
    /\{i18nT\("decrivez_le_sujet_de_cette_publication_d6313015"\)\}/,
  );

  const expectedByLocale: Record<string, string> = {
    "fr-FR":
      "Décrivez le sujet de cette publication et, si nécessaire, ajoutez une consigne ponctuelle.",
    "en-GB":
      "Describe the subject of this post and add any specific instructions.",
    "de-DE":
      "Beschreiben Sie den Inhalt dieses Beitrags und fügen Sie bei Bedarf eine konkrete Anweisung hinzu.",
    "es-ES":
      "Describa el tema de esta publicación y, si es necesario, agregue una instrucción específica.",
    "it-IT":
      "Descrivi l'argomento di questo post e, se necessario, aggiungi un'istruzione una tantum.",
    "nl-NL":
      "Beschrijf het onderwerp van dit bericht en voeg indien nodig een specifieke instructie toe.",
    "pt-PT":
      "Descreva o assunto desta publicação e, se necessário, adicione uma instrução específica.",
    "th-TH":
      "อธิบายหัวข้อของเอกสารนี้ และเพิ่มคำแนะนำเฉพาะเจาะจงหากจำเป็น",
    "zh-CN": "描述本出版物的主题，并在必要时添加具体说明。",
  };

  for (const [locale, expected] of Object.entries(expectedByLocale)) {
    const catalogue = JSON.parse(read(`messages/${locale}/booster.json`));
    assert.equal(
      catalogue.decrivez_le_sujet_de_cette_publication_d6313015,
      expected,
      locale,
    );
  }
});

test("publish actions keep their compact responsive layout and expose clear primary/secondary styling", () => {
  assert.match(
    footerActions,
    /styles\.publishScheduleButton[\s\S]*?programmer_ad97007f/,
  );
  assert.match(
    footerActions,
    /styles\.publishConfirmButton[\s\S]*?publishActionIcon[\s\S]*?🚀/,
  );
  assert.match(
    dashboardStyles,
    /\.publishConfirmButton \{[\s\S]*?linear-gradient\(112deg, #168cff 0%, #5b5df7 48%, #a63ee8 100%\);/,
  );
  assert.match(
    dashboardStyles,
    /\.publishScheduleButton \{[\s\S]*?linear-gradient\(135deg, rgba\(8, 145, 178, 0\.30\), rgba\(79, 70, 229, 0\.24\)\);/,
  );
  assert.match(
    dashboardStyles,
    /\.publishScheduleButton:focus-visible,[\s\S]*?\.publishConfirmButton:focus-visible/,
  );
  assert.match(
    dashboardStyles,
    /\.publishScheduleButton:disabled,[\s\S]*?\.publishConfirmButton:disabled/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 640px\)[\s\S]*?\.publishFooterActionsGroup \{[\s\S]*?grid-template-columns: minmax\(0, 0\.78fr\) minmax\(0, 1\.22fr\);/,
  );
});
