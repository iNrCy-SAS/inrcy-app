import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("iNrCalendar only confirms previous/next navigation after a real edit", () => {
  const source = read("app/dashboard/agenda/AgendaClient.tsx");
  assert.match(source, /const rdvHasUnsavedChanges = rdvOpen/);
  assert.match(source, /if \(rdvHasUnsavedChanges\) \{[\s\S]*i18nT\("changer_d_evenement_8ee6ed37"\)/);
  assert.match(source, /shouldBlock: rdvHasUnsavedChanges && !rdvSaving/);
});

test("iNrCRM resets the comparison baseline for each contact", () => {
  const source = read("app/dashboard/crm/_components/CRMContactModal.tsx");
  assert.match(source, /const contactIdentity = editingId \?\? "new-contact"/);
  assert.match(source, /current\?\.identity === contactIdentity/);
  assert.match(source, /if \(hasUnsavedChanges\) \{[\s\S]*i18nT\("changer_de_contact_sans_enregistrer_ed9e2ac9"\)/);
});

test("iNrCalendar event surfaces advertise clickability", () => {
  const css = read("app/dashboard/agenda/agenda.module.css");
  assert.match(css, /\.chip \{[\s\S]*cursor: pointer;[\s\S]*user-select: none;/);
  assert.match(css, /\.eventRow \{[\s\S]*cursor: pointer;[\s\S]*user-select: none;/);
});
