import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";
import { getServicesForSectorAndJob } from "../../lib/activityCatalog.ts";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(resolve(repo, file), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const mocked = new Set([
  "react", "react/jsx-runtime", "next-intl", "@/lib/supabaseClient", "@/lib/browserAccountCache",
  "@/lib/boosterGenerationContextClient", "@/lib/publicProfileRefreshClient", "@/lib/inrcyDialog",
]);
const sources: Record<string, string> = {};
const links: Record<string, Record<string, string>> = {};
function addSource(base: string): string {
  const file = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(file => existsSync(file) && statSync(file).isFile());
  assert.ok(file, `Resolve local fixture source ${base}`);
  const local = relative(repo, file);
  assert.ok(!isAbsolute(local) && local !== ".." && !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
  const id = local.replaceAll("\\", "/");
  if (sources[id]) return id;
  assert.ok(id.startsWith("lib/") || /\/settings\/_components\/(?:ActivityContent|EditableTags)\.tsx$/.test(id), `Unexpected production surface ${id}`);
  sources[id] = compile(readFileSync(file, "utf8"));
  links[id] = {};
  for (const match of sources[id].matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    if (mocked.has(name) || name.endsWith("useInrAssistantLocalInterface") || name.endsWith("MediaSubjectVoiceButton")) continue;
    const target = name.startsWith("@/") ? resolve(repo, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : null;
    assert.ok(target, `Unexpected fixture dependency ${name}`);
    links[id][name] = addSource(target);
  }
  return id;
}
const subject = addSource(resolve(repo, "app/dashboard/settings/_components/ActivityContent.tsx"));
for (const [name, file] of [
  ["react", "react.development.js"], ["react/jsx-runtime", "react-jsx-runtime.development.js"],
  ["react-dom", "react-dom.development.js"], ["react-dom/client", "react-dom-client.development.js"],
  ["scheduler", "scheduler.development.js"],
]) {
  const packageName = name === "react/jsx-runtime" ? "react" : name === "react-dom/client" ? "react-dom" : name;
  sources[name] = readFileSync(join(dirname(require.resolve(`${packageName}/package.json`)), "cjs", file), "utf8");
}
sources["intl-messageformat"] = compile(readFileSync(join(dirname(require.resolve("intl-messageformat")), "intl-messageformat.iife.js"), "utf8"));
const messages = Object.fromEntries(["settings", "dashboard"].map(namespace => [namespace, JSON.parse(read(`messages/fr-FR/${namespace}.json`))]));

const unchangedProfile = {
  user_id: "account-a", company_name: "Cabinet et Atelier Test", company_legal_name: "Entreprise Test SAS",
  siret: "12345678901234", legal_form: "SAS", address: "12 rue Exemple", city: "Lille",
  website: "https://business.example.invalid", phone: "0300000000", logo_path: "owned/logo.png",
  business_description: "Présentation métier déjà validée.", intervention_zones: ["Lille", "Roubaix"],
  strengths: ["Conseil personnalisé"], customer_typologies: ["professionnels"],
  opening_hours: "Lundi au vendredi de 9h à 18h", opening_days: "",
};
type Snapshot = { row: Record<string, unknown>; writes: Array<Record<string, unknown>>; loads: number; fetches: string[]; changes: boolean[] };
async function mount(page: Page, initial: Record<string, unknown> = {}, profileCore = false) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html lang="fr-FR"><head><style>body{margin:0;padding:20px;background:#09142a;color:white;font:14px Arial}input,select,button{font:inherit}</style></head><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},messages=${JSON.stringify(messages)},cache={},formats=new Map(),translators=new Map(),process={env:{NODE_ENV:'development'}};
    let row=${JSON.stringify({ ...unchangedProfile, sector: "", services: [], ...initial })},writes=[],loads=0,fetches=[],changes=[],key=0;
    const noOp=()=>{};
    const client={auth:{getUser:async()=>({data:{user:{id:'account-a'}},error:null})},from(table){
      if(table!=='business_profiles')throw Error('Unexpected table '+table);
      return {select(value){if(value!=='*')throw Error('Unexpected projection');return this},eq(field,value){if(field!=='user_id'||value!=='account-a')throw Error('Cross-account fixture access');return this},
        maybeSingle:async()=>{loads++;return {data:structuredClone(row),error:null}},
        upsert:async(payload,options)=>{if(payload.user_id!=='account-a'||options.onConflict!=='user_id')throw Error('Unexpected write scope');writes.push(structuredClone(payload));row={...row,...structuredClone(payload)};return {error:null}}
      };
    }};
    function choose(options){return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',options.title);
      const title=document.createElement('h2');title.textContent=options.title;dialog.append(title);
      const message=document.createElement('p');message.textContent=options.message;dialog.append(message);
      for(const choice of options.choices){const button=document.createElement('button');button.textContent=choice.label;button.onclick=()=>{dialog.close();dialog.remove();resolve(choice.value)};dialog.append(button)}
      dialog.oncancel=event=>{event.preventDefault();dialog.close();dialog.remove();resolve(null)};
      document.body.append(dialog);dialog.showModal();
    })}
    function translate(namespace){if(!translators.has(namespace))translators.set(namespace,(name,values={})=>{
      const id=namespace+'.'+name,value=id.split('.').reduce((value,part)=>value?.[part],messages);
      if(typeof value!=='string')throw Error('Missing catalogue message '+id);
      if(!formats.has(id))formats.set(id,new(load('intl-messageformat').IntlMessageFormat)(value,'fr-FR'));
      return formats.get(id).format(values);
    });return translators.get(namespace)}
    function load(name,parent=''){
      if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface:noOp};
      if(name.endsWith('MediaSubjectVoiceButton'))return {__esModule:true,default:()=>null};
      if(name==='next-intl')return {useTranslations:translate};
      if(name==='@/lib/supabaseClient')return {createClient:()=>client};
      if(name==='@/lib/browserAccountCache')return {resolveActiveBrowserUserId:id=>id};
      if(name==='@/lib/boosterGenerationContextClient')return {invalidateBoosterGenerationContextClient:async scope=>{if(scope!=='professional')throw Error('Wrong invalidation scope')}};
      if(name==='@/lib/publicProfileRefreshClient')return {refreshPublicProfileDependents:async scope=>{if(scope!=='activity')throw Error('Wrong refresh scope');return true}};
      if(name==='@/lib/inrcyDialog')return {chooseInrcy:choose,confirmInrcy:async()=>{throw Error('No destructive action in profession tests')}};
      const id=links[parent]?.[name]||name;if(cache[id])return cache[id].exports;
      if(!sources[id])throw Error('Unexpected fixture import '+name+' from '+parent);
      const module=cache[id]={exports:{}};new Function('require','module','exports','process',sources[id])(next=>load(next,id),module,module.exports,process);return module.exports;
    }
    window.fetch=async(url,options)=>{fetches.push(String(url));if(url!=='/api/loyalty/award'||options.method!=='POST'||JSON.parse(options.body).actionKey!=='activity_complete')throw Error('Unexpected network operation');return Response.json({ok:true})};
    const React=load('react'),Subject=load(${JSON.stringify(subject)}).default,root=load('react-dom/client').createRoot(document.getElementById('root')),activityRef=React.createRef();
    const onUnsavedChange=value=>changes.push(value);
    const render=()=>root.render(React.createElement(Subject,{key,ref:activityRef,mode:'page',contentScope:${JSON.stringify(profileCore ? "profile-core" : "all")},assistantActive:false,onUnsavedChange}));
    window.professionFixture={snapshot:()=>structuredClone({row,writes,loads,fetches,changes}),knowledgePatch:()=>structuredClone(activityRef.current.getBusinessKnowledgePatch()),remount(){key++;render()}};render();
  ` });
  page.setDefaultTimeout(5_000);
  await page.getByRole("combobox", { name: "Rechercher votre métier", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  return { errors, requests };
}
const snapshot = (page: Page) => page.evaluate("window.professionFixture.snapshot()") as Promise<Snapshot>;
async function openManual(page: Page) {
  const sector = page.getByRole("combobox", { name: /^Secteur d’activité/ });
  if (!await sector.count()) await page.getByRole("button", { name: "Parcourir les secteurs et métiers manuellement", exact: true }).click();
  await sector.waitFor();
  return { sector, job: page.getByRole("combobox", { name: /^Métier/ }) };
}
async function save(page: Page) {
  const before = (await snapshot(page)).writes.length;
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForFunction(count => window.document.body.innerText.includes("Enregistré") && (window as unknown as { professionFixture: { snapshot(): Snapshot } }).professionFixture.snapshot().writes.length === count, before + 1);
}

test("the real profession picker retains sector and profession only, with the two generic additions and existing choices", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), h = await mount(page);
    const { sector, job } = await openManual(page);
    for (const [category, value, label] of [
      ["sante", "chirurgien", "Chirurgien"], ["formation_enseignement", "formateur", "Formateur"],
      ["juridique", "avocat", "Avocat"], ["services_entreprises", "organisme_formation", "Formation"],
      ["hotel_restaurant", "hotel", "Hôtel"], ["tourisme", "camping", "Camping"],
    ]) {
      await sector.selectOption(category);
      assert.equal(await job.locator(`option[value="${value}"]`).textContent(), label);
    }
    assert.equal(await page.getByRole("combobox", { name: /spécialité|sous.métier/i }).count(), 0);
    assert.equal(await page.locator('select').count(), 2, "no additional hierarchy control is introduced");
    const search = page.getByRole("combobox", { name: "Rechercher votre métier", exact: true });
    for (const query of ["Chirurgien", "Formateur", "Organisme de formation"]) {
      await search.fill(query);
      const result = page.getByRole("listbox", { name: "Résultats des métiers", exact: true }).getByRole("option").filter({ hasText: query === "Organisme de formation" ? "Formation" : query });
      await result.first().waitFor();
    }
    assert.deepEqual((await snapshot(page)).writes, [], "browsing never saves the profile");
    assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  } finally { await browser.close(); }
});

for (const [category, value, label] of [["sante", "chirurgien", "Chirurgien"], ["formation_enseignement", "formateur", "Formateur"]] as const) {
  test(`${label}: suggested services remain freely editable and the real save/reload preserves the existing profile`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(), h = await mount(page);
      const controls = await openManual(page);
      await controls.sector.selectOption(category); await controls.job.selectOption(value);
      const suggested = getServicesForSectorAndJob(category, value);
      assert.equal(suggested.length, 8);
      const services = page.getByRole("region", { name: "Ajouter une prestation", exact: true });
      for (const service of suggested) await services.getByText(service, { exact: true }).waitFor();
      await services.getByRole("button", { name: `Retirer ${suggested[0]}`, exact: true }).click();
      const custom = `${label} : prestation définie librement par le professionnel`;
      await page.getByRole("button", { name: "+ Ajouter une prestation", exact: true }).click();
      const input = page.getByPlaceholder("Ex : Intervention week-end", { exact: true });
      await input.fill(custom); await input.press("Enter");
      await save(page);
      const saved = await snapshot(page);
      assert.equal(saved.row.sector, `[[SECTOR:${category}]] ${label}`);
      assert.deepEqual(saved.row.services, [...suggested.slice(1), custom]);
      assert.deepEqual(Object.keys(saved.writes[0]).sort(), ["user_id", "sector", "services", "business_description", "intervention_zones", "opening_days", "opening_hours", "strengths", "customer_typologies", "updated_at"].sort());
      for (const field of ["company_name", "company_legal_name", "siret", "legal_form", "address", "city", "website", "phone", "logo_path", "business_description", "intervention_zones", "strengths", "customer_typologies"] as const) assert.deepEqual(saved.row[field], unchangedProfile[field], field);
      await page.evaluate("window.professionFixture.remount()");
      await page.waitForFunction(() => (window as unknown as { professionFixture: { snapshot(): Snapshot } }).professionFixture.snapshot().loads === 2);
      const reloaded = await openManual(page);
      await reloaded.job.waitFor(); assert.equal(await reloaded.sector.inputValue(), category); assert.equal(await reloaded.job.inputValue(), value);
      await page.getByRole("region", { name: "Ajouter une prestation", exact: true }).getByText(custom, { exact: true }).waitFor();
      assert.equal(await page.getByRole("region", { name: "Ajouter une prestation", exact: true }).getByText(suggested[0], { exact: true }).count(), 0);
      assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
    } finally { await browser.close(); }
  });
}

test("changing to a new generic profession can keep existing free services, and profile-core saves omit every unrelated profile field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const services = ["Accompagnement sur mesure existant", "Prestation libre à conserver"];
    const page = await browser.newPage(), h = await mount(page, { sector: "[[SECTOR:juridique]] Avocat", services }, true);
    const controls = await openManual(page);
    await controls.sector.selectOption("formation_enseignement"); await controls.job.selectOption("formateur");
    const choice = page.getByRole("dialog", { name: "Quelles prestations conserver ?", exact: true });
    await choice.getByRole("button", { name: "Garder mes prestations", exact: true }).click();
    await save(page);
    const saved = await snapshot(page);
    assert.equal(saved.row.sector, "[[SECTOR:formation_enseignement]] Formateur");
    assert.deepEqual(saved.row.services, services);
    assert.deepEqual(Object.keys(saved.writes[0]).sort(), ["user_id", "sector", "updated_at"].sort(), "profile-core does not resend services, description, schedule or ADN");
    for (const [field, value] of Object.entries(unchangedProfile)) assert.deepEqual(saved.row[field], value, field);
    await page.evaluate("window.professionFixture.remount()");
    await page.waitForFunction(() => (window as unknown as { professionFixture: { snapshot(): Snapshot } }).professionFixture.snapshot().loads === 2);
    assert.equal(await (await openManual(page)).job.inputValue(), "formateur");
    assert.deepEqual((await snapshot(page)).row.services, services);
    assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  } finally { await browser.close(); }
});

test("profile-core explicitly replacing services exposes the real parent patch and persists only the changed profession and services", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const previousServices = ["Ancienne prestation libre", "Ancien accompagnement personnalisé"];
    const page = await browser.newPage(), h = await mount(page, { sector: "[[SECTOR:juridique]] Avocat", services: previousServices }, true);
    assert.deepEqual(await page.evaluate("window.professionFixture.knowledgePatch()"), {}, "the unchanged profile exposes no stale ADN patch");
    const controls = await openManual(page);
    await controls.sector.selectOption("formation_enseignement"); await controls.job.selectOption("formateur");
    const choice = page.getByRole("dialog", { name: "Quelles prestations conserver ?", exact: true });
    await choice.getByRole("button", { name: "Adapter les prestations", exact: true }).click();
    const expectedServices = getServicesForSectorAndJob("formation_enseignement", "formateur");
    const expectedPatch = { services: expectedServices };
    await page.waitForFunction(expected => JSON.stringify((window as unknown as { professionFixture: { knowledgePatch(): unknown } }).professionFixture.knowledgePatch()) === JSON.stringify(expected), expectedPatch);
    assert.deepEqual(await page.evaluate("window.professionFixture.knowledgePatch()"), expectedPatch, "the actual imperative handle gives the parent only the explicitly replaced services");
    assert.deepEqual((await snapshot(page)).row.services, previousServices, "selecting a replacement does not save automatically");
    await save(page);
    const saved = await snapshot(page);
    assert.equal(saved.row.sector, "[[SECTOR:formation_enseignement]] Formateur");
    assert.deepEqual(saved.row.services, expectedServices);
    assert.deepEqual(Object.keys(saved.writes[0]).sort(), ["user_id", "sector", "services", "updated_at"].sort());
    for (const [field, value] of Object.entries(unchangedProfile)) assert.deepEqual(saved.row[field], value, field);
    assert.deepEqual(await page.evaluate("window.professionFixture.knowledgePatch()"), {}, "a completed save clears the pending service patch");
    await page.evaluate("window.professionFixture.remount()");
    await page.waitForFunction(() => (window as unknown as { professionFixture: { snapshot(): Snapshot } }).professionFixture.snapshot().loads === 2);
    assert.equal(await (await openManual(page)).job.inputValue(), "formateur");
    assert.deepEqual((await snapshot(page)).row.services, expectedServices);
    assert.deepEqual(await page.evaluate("window.professionFixture.knowledgePatch()"), {}, "reload uses the saved services as its baseline");
    assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  } finally { await browser.close(); }
});
