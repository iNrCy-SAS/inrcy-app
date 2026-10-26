import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { getJobLabel, getServicesForSectorAndJob } from "../../lib/activityCatalog.ts";

const source = readFileSync(new URL("../../app/dashboard/settings/_components/ActivityContent.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ActivityContent.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Set(["chooseServiceReplacement", "handleSectorChange", "handleProfessionChange", "handleSearchSelection"]);
const declarations: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && handlers.has(node.name.text)) declarations.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, 4);
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Form = { sectorCategory: string; sector: string; services: string[]; activityDescription: string };
type ChoiceOptions = { defaultValue: string; choices: { value: string }[] };
const analyzedServices = ["Vente en ligne d’accessoires pour chiens et chats", "Colliers, laisses et harnais", "Livraison en France et en Europe"];
const suggestion = { sectorCategory: "commerce_boutique", job: "e_commerce", jobLabel: "E-commerce / Boutique en ligne" };

function fixture(choice: string | null, initial: Partial<Form> = {}) {
  const prompts: ChoiceOptions[] = [];
  const create = new Function("initial", "chooseInrcy", "getServicesForSectorAndJob", "getJobLabel", `
    let form = initial;
    const professionChoicePendingRef = { current: false };
    const i18nT = key => key;
    const setSaved = () => {}, setError = () => {}, setJobSearch = () => {}, setJobSearchOpen = () => {}, setManualSelectionOpen = () => {};
    const setForm = update => { form = update(form); };
    ${compiled}
    return { getForm: () => form, handleSectorChange, handleProfessionChange, handleSearchSelection };
  `);
  const editor = create({ sectorCategory: "commerce_boutique", sector: "", services: [...analyzedServices], activityDescription: "Notre boutique d’accessoires animaliers en ligne.", ...initial }, async (options: ChoiceOptions) => { prompts.push(options); return choice; }, getServicesForSectorAndJob, getJobLabel) as {
    getForm(): Form;
    handleSectorChange(sector: string): Promise<void>;
    handleProfessionChange(job: string, options?: { preserveServices?: boolean }): Promise<void>;
    handleSearchSelection(result: typeof suggestion): Promise<void>;
  };
  return { ...editor, prompts };
}

for (const entry of ["search", "manual"] as const) {
  test(`${entry}: selecting a profession after analysis can preserve all existing services`, async () => {
    const editor = fixture("keep");
    if (entry === "search") await editor.handleSearchSelection(suggestion);
    else await editor.handleProfessionChange(suggestion.job);
    assert.equal(editor.getForm().sector, "e_commerce");
    assert.deepEqual(editor.getForm().services, analyzedServices);
    assert.equal(editor.prompts[0].defaultValue, "keep");
    assert.deepEqual(editor.prompts[0].choices.map(choice => choice.value), ["keep", "replace", "cancel"]);
  });
  test(`${entry}: service replacement requires the explicit replacement choice`, async () => {
    const editor = fixture("replace");
    if (entry === "search") await editor.handleSearchSelection(suggestion);
    else await editor.handleProfessionChange(suggestion.job);
    assert.equal(editor.getForm().sector, "e_commerce");
    assert.deepEqual(editor.getForm().services, getServicesForSectorAndJob("commerce_boutique", "e_commerce"));
  });
  for (const choice of ["cancel", null]) test(`${entry}: ${choice ?? "closing the dialog"} changes neither profession nor services`, async () => {
    const editor = fixture(choice);
    const original = editor.getForm();
    if (entry === "search") await editor.handleSearchSelection(suggestion);
    else await editor.handleProfessionChange(suggestion.job);
    assert.deepEqual(editor.getForm(), original);
  });
}

test("changing sectors first does not erase analyzed services before a profession is chosen", async () => {
  const editor = fixture("keep", { sectorCategory: "autre" });
  await editor.handleSectorChange("commerce_boutique");
  assert.deepEqual(editor.getForm().services, analyzedServices);
  assert.equal(editor.prompts.length, 0);
  await editor.handleProfessionChange("e_commerce");
  assert.deepEqual(editor.getForm().services, analyzedServices);
});

test("a new empty activity still receives its profession suggestions without an unnecessary dialog", async () => {
  const editor = fixture("keep", { services: [] });
  await editor.handleSearchSelection(suggestion);
  assert.deepEqual(editor.getForm().services, getServicesForSectorAndJob("commerce_boutique", "e_commerce"));
  assert.equal(editor.prompts.length, 0);
});
