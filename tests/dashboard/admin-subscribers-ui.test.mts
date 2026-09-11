import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("la page Abonnés est protégée côté serveur par le rôle Admin", () => {
  const page = read("app/dashboard/admin/subscribers/page.tsx");

  assert.match(page, /await getMyRole\(\)/);
  assert.match(page, /if \(!isAdmin\) redirect\("\/dashboard"\)/);
  assert.match(page, /<AdminSubscribersClient \/>/);
});

test("le listing consomme le contrat de lecture des abonnés sans mutation", () => {
  const client = read("app/dashboard/admin/subscribers/AdminSubscribersClient.tsx");

  assert.match(client, /fetch\("\/api\/admin\/subscribers"/);
  assert.match(client, /credentials: "include"/);
  assert.match(client, /cache: "no-store"/);
  for (const field of [
    "user_id",
    "name",
    "email",
    "phone",
    "amount_eur",
    "billing_cycle",
    "payment_status",
    "payment_provider",
    "last_followup_at",
    "next_renewal_date",
    "active_count",
    "payment_issue_count",
    "monthly_revenue_eur",
  ]) {
    assert.match(client, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("les colonnes sont lisibles dans l'ordre métier demandé", () => {
  const client = read("app/dashboard/admin/subscribers/AdminSubscribersClient.tsx");
  const headers = ["Nom", "E-mail", "Téléphone", "Montant", "Statut paiement", "Dernier suivi"];
  let previousIndex = -1;

  for (const header of headers) {
    const index = client.indexOf(`<span>${header}</span>`, previousIndex + 1);
    assert.ok(index > previousIndex, `La colonne ${header} doit être présente dans le bon ordre.`);
    previousIndex = index;
  }
  assert.match(client, /Renouvellement :/);
  assert.match(client, /formatMonthlyAmount\(subscriber\.amount_eur\)/);
  assert.match(client, /Facturation annuelle/);
  assert.doesNotMatch(client, /return "par an"/);
});

test("l'interface prévoit recherche locale, chargement, erreur et listes vides", () => {
  const client = read("app/dashboard/admin/subscribers/AdminSubscribersClient.tsx");
  const css = read("app/dashboard/admin/subscribers/subscribers.module.css");

  assert.match(client, /const visibleSubscribers = useMemo/);
  assert.match(client, /type="search"/);
  assert.match(client, /Chargement des abonnés…/);
  assert.match(client, /Aucun abonné pour le moment/);
  assert.match(client, /Aucun résultat/);
  assert.match(client, /role="alert"/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /\.tableBody\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 500px\)/);
});

test("la tuile Abonnés remplace proprement un emplacement à venir", () => {
  const adminHome = read("app/dashboard/admin/page.tsx");

  assert.match(adminHome, /href: "\/dashboard\/admin\/subscribers"/);
  assert.match(adminHome, /title: "Abonnés"/);
  assert.match(adminHome, /Array\.from\(\{ length: 3 \}/);
  assert.match(adminHome, /const activeToolCount = tools\.length/);
});
