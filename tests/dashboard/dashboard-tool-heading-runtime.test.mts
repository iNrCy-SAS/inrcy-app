import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;

function load(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as { default: (props: Props) => ReactNode } };
  new Function("module", "exports", "require", compiled)(record, record.exports, (name: string) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (name in dependencies) return dependencies[name];
    assert.fail(`Unexpected heading dependency: ${name}`);
  });
  return record.exports.default;
}

function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children as ReactNode)] : [];
}

const Robot = () => createElement("button", { type: "button", "aria-label": "Ouvrir iNrAssistant" }, "robot");
const Heading = load("app/dashboard/_components/DashboardToolHeading.tsx", {
  "./DashboardAssistantTrigger": { __esModule: true, default: Robot },
});

test("tool identity keeps title and robot together, with one subtitle underneath", () => {
  const tree = Heading({ children: createElement("h1", {}, "Réputation"), subtitle: "Tous vos avis Google" });
  const row = nodes(tree).find(node => "data-dashboard-tool-title" in node.props)!;
  const rowNodes = nodes(row);
  assert.ok(rowNodes.some(node => node.type === "h1"));
  assert.ok(rowNodes.some(node => node.type === Robot));
  assert.ok(!rowNodes.some(node => node.type === "p"), "The description must not share the title/robot axis");
  const subtitles = nodes(tree).filter(node => "data-dashboard-tool-subtitle" in node.props);
  assert.equal(subtitles.length, 1);
  assert.equal(subtitles[0]?.props.children, "Tous vos avis Google");
});

test("reputation has a single description and preserves the Standard review-request gate", () => {
  for (const edition of ["standard", "premium"]) {
    const Reputation = load("app/dashboard/e-reputation/EReputationHeader.tsx", {
      "next/link": { __esModule: true, default: (props: Props) => createElement("a", props) },
      "../_components/DashboardToolHeading": { __esModule: true, default: Heading },
      "@/app/dashboard/_components/DashboardEditionProvider": { useDashboardEdition: () => edition },
    });
    const html = renderToStaticMarkup(Reputation({ title: "Réputation", tagline: "Tous vos avis Google", sublineDesktop: "Ancienne seconde description", sublineMobile: "Ancienne seconde description mobile", manageLabel: "Gérer", askReviewsLabel: "Demander des avis", closeLabel: "Fermer", askReviewsHref: "/dashboard/propulser?action=reviews" }));
    assert.equal((html.match(/Tous vos avis Google/g) || []).length, 1);
    assert.ok(!html.includes("Ancienne seconde description"));
    assert.ok(html.includes("Ouvrir iNrAssistant"));
    assert.equal(html.includes("Demander des avis"), edition === "premium");
  }
});

test("media recharges has a compact title and assistant access while retaining the packs and Studio return", () => {
  const Page = load("app/dashboard/boutique/recharges/page.tsx", {
    react: require("react"),
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "next-intl": { useTranslations: () => (key: string) => ({ media_credit_recharge_title: "Recharger mes crédits médias", video_credit_description: "Un solde commun pour les images et vidéos." } as Record<string, string>)[key] || key },
    "next/link": { __esModule: true, default: (props: Props) => createElement("a", props) },
    "@/app/dashboard/_components/DashboardToolHeading": { __esModule: true, default: Heading },
    "@/app/dashboard/_components/VideoCreditRecharge": { VideoCreditPacksPanel: () => createElement("section", { "data-credit-packs": true }, "Packs existants") },
  });
  const html = renderToStaticMarkup(Page({}));
  const header = html.match(/<header[^>]*>(.*?)<\/header>/)?.[1] || "";
  assert.ok(header.includes("Recharger mes crédits médias"));
  assert.ok(header.includes("Ouvrir iNrAssistant"));
  assert.ok(header.includes('href="/dashboard/generer-media"'));
  assert.equal((header.match(/Un solde commun/g) || []).length, 1);
  assert.ok(html.includes("data-credit-packs"));
});
