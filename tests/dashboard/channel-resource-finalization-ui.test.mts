import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const panels = [
  {
    file: "FacebookPanel.tsx",
    detected: "facebookPageDetected",
    connected: "facebookPageConnected",
  },
  {
    file: "InstagramPanel.tsx",
    detected: "instagramProfileDetected",
    connected: "instagramConnected",
  },
  {
    file: "LinkedinPanel.tsx",
    detected: "linkedinOrganizationDetected",
    connected: "hasCompanyPage",
  },
  {
    file: "GoogleBusinessPanel.tsx",
    detected: "gmbLocationDetected",
    connected: "gmbConfigured",
  },
] as const;

for (const panel of panels) {
  test(`${panel.file}: la finalisation silencieuse reste visuellement connectée`, () => {
    const source = read(`app/dashboard/_components/${panel.file}`);

    assert.match(
      source,
      new RegExp(`${panel.detected}\\s*=\\s*[^;]+===\\s*"connecting"`),
    );
    assert.match(source, new RegExp(`${panel.detected}\\s*&&\\s*!`));
    assert.match(source, /i18nT\("connecte_ce09957c"\)/);
    assert.match(
      source,
      new RegExp(`connected=\\{${panel.connected}\\s*\\|\\|\\s*${panel.detected}\\}`),
    );
  });
}

test("Instagram explique les prérequis professionnel, créateur et Page Facebook", () => {
  const source = read("app/dashboard/_hooks/channels/useInstagramChannel.ts");

  assert.match(source, /le compte doit être Professionnel ou Créateur/);
  assert.match(source, /associé à votre Page Facebook professionnelle/);
  assert.match(source, /Aucun profil Instagram compatible n’a été trouvé/);
  assert.match(source, /withInstagramSetupHelp\(e,/);
  assert.match(source, /setPanelError\(setupError, setupError, 6000\)/);
});
