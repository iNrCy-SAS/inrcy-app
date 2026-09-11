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

test("le listing consomme le contrat de lecture et limite la mutation à une confirmation explicite", () => {
  const client = read("app/dashboard/admin/subscribers/AdminSubscribersClient.tsx");

  assert.match(client, /fetch\("\/api\/admin\/subscribers"/);
  assert.match(client, /credentials: "include"/);
  assert.match(client, /cache: "no-store"/);
  for (const field of [
    "user_id",
    "name",
    "company_name",
    "email",
    "phone",
    "amount_eur",
    "billing_cycle",
    "payment_status",
    "stored_payment_status",
    "payment_status_source",
    "payment_provider",
    "last_followup_at",
    "next_renewal_date",
    "reconciliation_status",
    "reconciliation_method",
    "reconciliation_candidate",
    "stripe_subscription_id",
    "active_count",
    "payment_issue_count",
    "monthly_revenue_eur",
    "unpriced_active_count",
    "revenue_complete",
    "unverified_count",
    "reconciliation_anomaly_count",
    "review_required_count",
    "stripe_reconciliation",
  ]) {
    assert.match(client, new RegExp(`\\b${field}\\b`));
  }
  assert.match(client, /window\.confirm\(/);
  assert.match(client, /COMPTE INRCY/);
  assert.match(client, /ABONNEMENT STRIPE/);
  assert.match(client, /Société :/);
  assert.match(client, /candidate\.amount_eur/);
  assert.match(client, /candidate\.payment_status/);
  assert.match(client, /method:\s*"POST"/);
  assert.match(client, /user_id:\s*subscriber\.user_id/);
  assert.match(client, /stripe_subscription_id:\s*stripeSubscriptionId/);
  assert.match(client, /Confirmer le rapprochement/);
  assert.doesNotMatch(client, /method:\s*"(?:PUT|PATCH|DELETE)"/);
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
  assert.match(client, /Stripe est momentanément indisponible/);
  assert.match(client, /Stripe · à rapprocher/);
  assert.match(client, /Compte iNrCy · confirmation requise/);
  assert.match(client, /Supabase :.*non confirmé/);
  assert.match(client, /Montant Supabase non confirmé/);
  assert.match(client, /estimation incomplète/);
  assert.match(client, /const liveBillingPartial = !liveBillingUnavailable && unverifiedCount > 0/);
  assert.match(client, /liveBillingPartial \? `≥ \$\{summary\.activeCount\}`/);
  assert.match(client, /liveBillingPartial[\s\S]*`≥ \$\{formatCurrency\(summary\.monthlyRevenueEur\)\}`/);
  assert.match(client, /actif[\s\S]*confirmé[\s\S]*non vérifié/);
  assert.match(client, /incident[\s\S]*confirmé[\s\S]*non vérifié/);
  assert.match(client, /vérification Stripe indisponible/);
  assert.match(client, /unverified: "Non vérifié"/);
  assert.match(css, /\.reconciliationWarning/);
  assert.match(css, /\.confirmButton/);
  assert.match(css, /\.confirmationSuccess/);
  assert.match(css, /data-reconciliation-tone="attention"/);
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
