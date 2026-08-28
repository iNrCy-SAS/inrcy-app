import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAvailableEstablishmentSlots } from "../../lib/multicompte/normalize.ts";

const migration = readFileSync(
  new URL("../../ops/sql/2026-07-05_multicompte_step4_ui_admin_creation.sql", import.meta.url),
  "utf8",
);
const accountsRoute = readFileSync(
  new URL("../../app/api/multicompte/accounts/route.ts", import.meta.url),
  "utf8",
);
const menu = readFileSync(
  new URL("../../app/dashboard/_components/EstablishmentMenu.tsx", import.meta.url),
  "utf8",
);
const adminRoute = readFileSync(
  new URL("../../app/api/admin/users/route.ts", import.meta.url),
  "utf8",
);

test("un compte normal FALSE ne reçoit aucun emplacement de création", () => {
  assert.equal(getAvailableEstablishmentSlots({ multiAccountEnabled: false, maxEstablishments: 3 }, 1), 0);
});

test("un compte TRUE à 3 affiche deux emplacements si un seul établissement existe", () => {
  assert.equal(getAvailableEstablishmentSlots({ multiAccountEnabled: true, maxEstablishments: 3 }, 1), 2);
  assert.equal(getAvailableEstablishmentSlots({ multiAccountEnabled: true, maxEstablishments: 3 }, 2), 1);
  assert.equal(getAvailableEstablishmentSlots({ multiAccountEnabled: true, maxEstablishments: 3 }, 3), 0);
});

test("la création SQL est atomique et verrouille la config quota", () => {
  assert.match(migration, /inrcy_create_establishment\(p_display_name text\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /INRCY_MULTICOMPTE_DISABLED/i);
  assert.match(migration, /INRCY_ESTABLISHMENT_LIMIT_REACHED/i);
  assert.match(migration, /inrcy_set_multi_account_config/i);
  assert.match(migration, /INRCY_MAX_BELOW_ACCOUNT_COUNT/i);
  assert.doesNotMatch(migration, /insert into public\.subscriptions/i);
});

test("les futurs comptes AUTH sont provisionnés automatiquement sans changer l'UUID historique", () => {
  assert.match(migration, /after insert on auth\.users/i);
  assert.match(migration, /values \(new\.id, v_display_name, new\.id\)/i);
  assert.match(migration, /values \(new\.id, new\.id, 'owner', true\)/i);
});

test("la route de création ouvre le nouvel établissement et ne crée pas de nouvel AUTH", () => {
  assert.match(accountsRoute, /supabase\.rpc\("inrcy_create_establishment"/i);
  assert.match(accountsRoute, /response\.cookies\.set\(ACTIVE_INRCY_ACCOUNT_COOKIE/i);
  assert.doesNotMatch(accountsRoute, /auth\.admin\.createUser/i);
});

test("le header affiche toujours le sélecteur et garde le message de contact", () => {
  assert.match(menu, /t\("mes_etablissements_e04da90f"\)/);
  assert.match(menu, /contactez iNrCy/);
  assert.match(menu, /getAvailableEstablishmentSlots/);
});

test("l'Admin pilote TRUE FALSE et le maximum autorisé", () => {
  assert.match(adminRoute, /multi_account_enabled/);
  assert.match(adminRoute, /max_establishments/);
  assert.match(adminRoute, /inrcy_set_multi_account_config/i);
  assert.match(adminRoute, /Impossible de descendre sous/i);
});
