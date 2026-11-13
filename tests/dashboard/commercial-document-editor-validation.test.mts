import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { IntlMessageFormat } from "intl-messageformat";
import {
  commercialDocumentCompletionError,
  commercialDocumentLinesForEditor,
  commercialDocumentMissingFields,
} from "../../lib/commercialDocumentValidation.ts";

const documentLocales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const documentCatalogs = Object.fromEntries(documentLocales.map(locale => [locale, JSON.parse(readFileSync(new URL(`../../messages/${locale}/documents.json`, import.meta.url), "utf8")) as Record<string, string>]));
const documentTranslate = (locale = "fr-FR") => (key: string, values: Record<string, string | number> = {}) => {
  assert.ok(documentCatalogs[locale][key], `${locale}: missing document message ${key}`);
  return String(new IntlMessageFormat(documentCatalogs[locale][key], locale).format(values));
};

const rawLines = [
  { id: "l_1", label: "Entretien du jardin", qty: 1, unitPrice: 120, vatRate: 20 },
  { id: "l_2", label: "Évacuation", qty: 1, unitPrice: 30, vatRate: 0 },
];
const payload = {
  clientName: "Client Test", clientType: "particulier", clientEmail: "client@example.test",
  billingAddress: "2 rue du Test", billingPostalCode: "62000", billingCity: "Arras",
  number: "DEV-2026-001", invoiceDate: "2026-10-31", dueDate: "2026-11-30",
  docDateISO: "2026-10-31", validityDays: 30, vatDispense: true, lines: rawLines,
};

for (const kind of ["facture", "devis"] as const) {
  test(`${kind}: reopening an exempt draft with a hidden 20% rate saves the displayed 0% and passes native validation`, () => {
    assert.ok(commercialDocumentMissingFields(kind, payload).includes("Taux de TVA de chaque ligne"));
    const saved = { ...payload, lines: commercialDocumentLinesForEditor(rawLines, true) };
    assert.deepEqual(saved.lines.map(line => line.vatRate), [0, 0]);
    assert.deepEqual(commercialDocumentMissingFields(kind, saved), []);
    assert.equal(saved.lines[0].qty, rawLines[0].qty);
    assert.equal(saved.lines[0].unitPrice, rawLines[0].unitPrice);
    assert.equal(rawLines[0].vatRate, 20, "saved or finalized source data is never mutated");
  });
}

test("taxable business lines retain their selected 20%, 10%, 5.5% or 0% rates", () => {
  const lines = [20, 10, 5.5, 0].map((vatRate, i) => ({ ...rawLines[0], id: `line_${i}`, vatRate }));
  assert.deepEqual(commercialDocumentLinesForEditor(lines, false), lines);
  assert.deepEqual(lines.map(line => line.vatRate), [20, 10, 5.5, 0]);
});

test("corrected VAT never bypasses a missing client field or invalid line", () => {
  const lines = commercialDocumentLinesForEditor([{ ...rawLines[0], qty: 0 }], true);
  const missing = commercialDocumentMissingFields("facture", { ...payload, billingCity: "", lines });
  assert.deepEqual(missing, ["Ville", "Libellé, quantité et prix HT de chaque ligne"]);
});

test("both actual native save snapshots persist effective tax rates", () => {
  for (const page of ["factures", "devis"]) {
    const source = readFileSync(new URL(`../../app/dashboard/${page}/new/page.tsx`, import.meta.url), "utf8");
    const start = source.indexOf("    const snapshot:", source.indexOf("  const saveDraft = async"));
    const end = source.indexOf("\n    const {", start);
    const snapshotSource = source.slice(start, end);
    assert.ok(start > 0 && end > start, "real saveDraft snapshot located");
    const expression = ts.transpileModule(`${snapshotSource}\n result = snapshot;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const names = [...new Set([...snapshotSource.matchAll(/^      ([a-zA-Z][a-zA-Z0-9]*)(?:,|:)/gm)].map(match => match[1]))];
    const context: Record<string, unknown> = Object.fromEntries(names.map(name => [name, ""]));
    Object.assign(context, {
      finalNumber: "DOC-001", nowISO: "2026-10-31T10:00:00Z", normalizedBillingAddress: "2 rue Test 62000 Arras",
      billingAddress: "2 rue Test", billingPostalCode: "62000", billingCity: "Arras",
      deliveryAddress: "", deliveryPostalCode: "", deliveryCity: "", sameAddresses: true, savedServiceDate: "", savedServicePeriodStart: "", savedServicePeriodEnd: "",
      providerOverride: {}, clientEmail: "client@example.test", clientName: "Client Test", clientType: "particulier", vatDispense: true,
      lines: rawLines, isFinalized: false, finalizedAt: "", options: {}, commercialDocumentLinesForEditor,
    });
    vm.runInNewContext(expression, context);
    const saved = context.result as { lines: typeof rawLines; vatDispense: boolean; clientAddress: string; deliveryAddress: string; deliveryPostalCode: string; deliveryCity: string };
    assert.equal(saved.vatDispense, true);
    assert.deepEqual([...saved.lines.map(line => line.vatRate)], [0, 0]);
    assert.equal(rawLines[0].vatRate, 20);
    assert.equal(saved.clientAddress, "2 rue Test 62000 Arras");
    assert.deepEqual([saved.deliveryAddress, saved.deliveryPostalCode, saved.deliveryCity], ["2 rue Test", "62000", "Arras"], "the current snapshot derives a shared delivery address from billing fields");
    const separateAddressContext: Record<string, unknown> = { ...context, sameAddresses: false, deliveryAddress: " 3 rue Livraison ", deliveryPostalCode: " 62100 ", deliveryCity: " Calais " };
    vm.runInNewContext(expression, separateAddressContext);
    const separateAddress = separateAddressContext.result as typeof saved;
    assert.deepEqual([separateAddress.deliveryAddress, separateAddress.deliveryPostalCode, separateAddress.deliveryCity], ["3 rue Livraison", "62100", "Calais"], "a distinct delivery address uses its own current fields");
    const finalizedContext: Record<string, unknown> = { ...context, isFinalized: true };
    vm.runInNewContext(expression, finalizedContext);
    assert.deepEqual([...(finalizedContext.result as { lines: typeof rawLines }).lines.map(line => line.vatRate)], [20, 0], "a finalized document keeps its persisted financial fields");
  }
});

test("finalization shows the exact missing fields returned by the server", () => {
  assert.equal(commercialDocumentCompletionError({ error: "Complétez les champs manquants avant de figer le document.", missingFields: ["Code postal", "Ville", "Ville"] }, "Échec"), "À compléter : Code postal · Ville.");
  assert.equal(commercialDocumentCompletionError({ error: "La numérotation officielle est indisponible." }, "Échec"), "La numérotation officielle est indisponible.");
  assert.equal(commercialDocumentCompletionError(null, "Réessayez après avoir vérifié la sauvegarde."), "Réessayez après avoir vérifié la sauvegarde.");
});

test("the list reader and duplicate source preserve a valid zero VAT rate for a taxable business", () => {
  const source = readFileSync(new URL("../../app/dashboard/_documents/docSaveStore.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { normalizeDocSave(row: unknown): { lines: typeof rawLines } } };
  const deps: Record<string, unknown> = {
    "@/lib/browserAccountCache": {}, "@/lib/supabaseClient": {},
    "./docUtils": { generateNumber: () => "DOC-001", uid: () => "line-copy" },
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date })(
    (name: string) => { assert.ok(name in deps); return deps[name]; }, mod, mod.exports,
  );
  for (const kind of ["facture", "devis"]) {
    const row = { id: "doc", type: kind, payload: { ...payload, vatDispense: false, lines: rawLines }, updated_at: "2026-10-31T10:00:00Z" };
    assert.deepEqual([...mod.exports.normalizeDocSave(row).lines.map(line => line.vatRate)], [20, 0]);
    assert.deepEqual(rawLines.map(line => line.vatRate), [20, 0]);
  }
});

test("native draft save waits for the business profile instead of assuming the default tax regime", async () => {
  for (const page of ["factures", "devis"]) {
    const source = readFileSync(new URL(`../../app/dashboard/${page}/new/page.tsx`, import.meta.url), "utf8");
    const start = source.indexOf("  const saveDraft = async");
    const end = source.indexOf("    const nowISO", start);
    const compiled = ts.transpileModule(`${source.slice(start, end)} return "ready"; }; result = saveDraft();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const messages: unknown[] = [];
    const context: Record<string, unknown> = { profile: null, i18nT: documentTranslate(), setFormMessage: (message: unknown) => messages.push(message) };
    vm.runInNewContext(compiled, context);
    assert.equal(await context.result, null);
    assert.equal(messages.length, 1);
  }
});

test("the actual invoice finalization handler presents returned missing fields without allocating or rewriting anything", async () => {
  const source = readFileSync(new URL("../../app/dashboard/factures/new/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const finalizeInvoice = async");
  const end = source.indexOf("\n  const openDraft", start);
  const compiled = ts.transpileModule(`${source.slice(start, end)} result = finalizeInvoice("doc-1");`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const messages: Array<{ type: string; text: string }> = [];
  const currentVersion = { documentId: "doc-1" };
  const context: Record<string, unknown> = {
    i18nT: documentTranslate(),
    documentEdits: {
      captureSave: () => currentVersion,
      isCurrentSave: (version: unknown) => { assert.equal(version, currentVersion); return true; },
      markPersistedFields: () => assert.fail("A failed finalization must not acknowledge edits"),
    },
    fetch: async () => ({ ok: false, json: async () => ({ error: "Complétez les champs manquants avant de figer le document.", missingFields: ["Code postal", "Ville"] }) }),
    commercialDocumentCompletionError, getSimpleFrenchErrorMessage: (value: unknown) => typeof value === "object" && value && "message" in value ? value.message : String(value),
    setFinalizing: () => undefined, setFormMessage: (message: { type: string; text: string }) => messages.push(message),
  };
  vm.runInNewContext(compiled, context);
  assert.equal(await context.result, null);
  assert.equal(messages[0].text, "À compléter : Code postal · Ville.");
});

test("the actual quote and invoice validators keep incomplete documents blocked with localized field errors in all nine languages", () => {
  for (const domain of ["devis", "factures"]) {
    const source = readFileSync(new URL(`../../app/dashboard/${domain}/new/page.tsx`, import.meta.url), "utf8");
    const name = domain === "devis" ? "validateQuoteAction" : "validateInvoiceAction";
    const start = source.indexOf(`  const ${name} =`);
    const end = source.indexOf("  const saveDraft =", start);
    assert.ok(start > 0 && end > start, "actual validation handler located");
    const compiled = ts.transpileModule(`${source.slice(start, end)} result = ${name}({ requireEmail: true });`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    for (const locale of documentLocales) {
      const i18nT = documentTranslate(locale);
      for (const clientType of ["", "professionnel"]) {
        let errors: Record<string, string> = {};
        const context: Record<string, unknown> = {
          i18nT, lines: [], clientType, clientName: "", clientEmail: "", clientSiren: "", number: "",
          billingAddress: "", billingPostalCode: "", billingCity: "", docDateISO: "", validityDays: 0,
          invoiceDate: "", dueDate: "", operationCategory: "", isValidEmail: () => false,
          setAdvancedOpen: () => undefined, setFormMessage: () => undefined,
          setFieldErrors: (next: Record<string, string>) => { errors = next; },
        };
        vm.runInNewContext(compiled, context);
        assert.equal(context.result, false, `${domain}/${locale}: invalid data never passes validation`);
        assert.equal(errors.clientName, i18nT("validation_client_name"));
        assert.equal(errors.billingCity, i18nT("validation_city"));
        assert.equal(errors.clientEmail, i18nT("validation_email_required"));
        assert.equal(errors.lines, i18nT("validation_valid_line"));
        assert.equal(clientType ? errors.clientSiren : errors.clientType, i18nT(clientType ? "validation_client_siren" : "validation_client_type"));
        assert.ok(Object.values(errors).every(error => Object.values(documentCatalogs[locale]).includes(error)), `${domain}/${locale}: every field message comes from the selected language`);
      }
    }
  }
});

test("server completion details localize known native field names in all nine languages while preserving unknown details and source data", () => {
  const response = { missingFields: ["Code postal", "Ville", "Ville", "Détail fournisseur XYZ"] };
  const original = JSON.stringify(response);
  for (const locale of documentLocales) {
    const i18nT = documentTranslate(locale);
    assert.equal(commercialDocumentCompletionError(response, "fallback", i18nT), i18nT("completion_missing_fields", { fields: `${i18nT("code_postal_74779109")} · ${i18nT("ville_97217611")} · Détail fournisseur XYZ` }));
  }
  assert.equal(JSON.stringify(response), original);
});
