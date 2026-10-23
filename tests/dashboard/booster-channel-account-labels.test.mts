import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const sourceText = readFileSync("app/dashboard/booster/publier/components/PublishChannelSelector.tsx", "utf8");
const source = ts.createSourceFile("PublishChannelSelector.tsx", sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "getChannelAccountName");
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const accountName = new Function(`${code}\nreturn getChannelAccountName;`)() as (
  info: { fullLabel: string; requiresReconnect?: boolean } | null,
  connected: boolean,
  channelLabel: string,
  companyName?: string,
) => string;

test("channel subtitles use the actual account name without truncating the underlying accessible text", () => {
  assert.equal(accountName({ fullLabel: "  Atelier des lumières — Paris  " }, true, "Facebook"), "Atelier des lumières — Paris");
  assert.equal(accountName({ fullLabel: "@atelier" }, true, "Instagram"), "@atelier");
  assert.equal(accountName({ fullLabel: "exemple.fr" }, true, "Site Web"), "exemple.fr");
});

test("connection state fallbacks and duplicated channel labels never become account names", () => {
  for (const fullLabel of ["Compte X connecté", "Compte Instagram connecté", "Page Facebook connectée", "Page LinkedIn connectée", "Fiche Google connectée", "Chaîne YouTube connectée", "Page iNr'Search publiée", "Page iNr'Search indisponible", "Site web connecté"]) {
    assert.equal(accountName({ fullLabel }, true, "Canal"), "");
  }
  assert.equal(accountName({ fullLabel: "FACEBOOK" }, true, "Facebook"), "");
  assert.equal(accountName({ fullLabel: "Reconnecter dans Mes canaux", requiresReconnect: true }, true, "Facebook"), "");
  assert.equal(accountName({ fullLabel: "Connexion indisponible" }, false, "Facebook"), "");
  assert.equal(accountName(null, true, "Facebook"), "");
});

test("iNr'Search uses the current company name while preserving connection guards", () => {
  const info = { fullLabel: "Page iNr'Search publiée" };
  assert.equal(accountName(info, true, "iNr'Search", "  Atelier Lumière  "), "Atelier Lumière");
  assert.equal(accountName(info, true, "iNr'Search", ""), "");
  assert.equal(accountName(info, false, "iNr'Search", "Atelier Lumière"), "");
  assert.equal(accountName({ ...info, requiresReconnect: true }, true, "iNr'Search", "Atelier Lumière"), "");
  assert.match(sourceText, /key === "inr_search" \? companyName : undefined/);
});

test("both card layouts expose a direct account subtitle without the old floating connection popover", () => {
  assert.equal((sourceText.match(/className=\{css\.accountName\} title=\{accountName\}/g) || []).length, 2);
  assert.doesNotMatch(sourceText, /isInfoVisible|info\.desktopLabel|info\.mobileLabel/);
  assert.match(sourceText, /className=\{css\.connectionButton\}/);
  assert.match(sourceText, /className=\{css\.desktopConnection\}/);
});
