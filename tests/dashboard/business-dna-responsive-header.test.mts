import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const page = read("app/dashboard/adn-entreprise/page.tsx");
const header = read("app/dashboard/_components/DashboardWorkspaceHeader.tsx");

test("ADN opts into the compact two-row header with the official round IA mark and close icon", () => {
  assert.match(page, /import AiConfigurationIcon from "\.\.\/_components\/AiConfigurationIcon"/);
  assert.match(page, /<DashboardWorkspaceHeader[\s\S]*?responsiveTwoRow/);
  assert.match(page, /mobileIcon:\s*\([\s\S]*?<AiConfigurationIcon[\s\S]*?size=\{28\}[\s\S]*?border:\s*"1px solid rgba\(250,204,21,0\.42\)"[\s\S]*?background:\s*"radial-gradient/);
  assert.match(page, /label:\s*copy\.userMenu\.ai[\s\S]*?mobileBare:\s*true[\s\S]*?mobileIcon:\s*\(/);
  assert.match(page, /label:\s*copy\.drawer\.close[\s\S]*?mobileIcon:\s*"×"/);
});

test("the opt-in responsive header keeps title and controls on row one and shows the full subtitle on row two", () => {
  assert.match(header, /data-responsive-two-row=\{responsiveTwoRow \? "true" : undefined\}/);
  assert.match(header, /\[data-dashboard-workspace-action-icon\][\s\S]*?display:\s*none;[\s\S]*?@media \(max-width: 820px\)/);
  assert.match(header, /@media \(max-width: 820px\)[\s\S]*?grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto/);
  assert.match(header, /\[data-dashboard-workspace-subtitle\][\s\S]*?grid-column:\s*1 \/ -1[\s\S]*?grid-row:\s*2[\s\S]*?text-overflow:\s*clip !important[\s\S]*?white-space:\s*normal !important/);
  assert.match(header, /nav button\[data-has-mobile-icon="true"\][\s\S]*?display:\s*inline-flex[\s\S]*?width:\s*38px[\s\S]*?height:\s*38px/);
  assert.match(
    header,
    /nav button\[data-mobile-bare="true"\][\s\S]*?border:\s*1px solid rgba\(148, 163, 255, 0\.3\) !important[\s\S]*?border-radius:\s*999px !important[\s\S]*?background:\s*radial-gradient[\s\S]*?box-shadow:/,
  );
  assert.match(header, /aria-label=\{action\.label\}/);
});

test("the compact layout remains opt-in so desktop and other workspace headers keep their existing treatment", () => {
  assert.match(header, /responsiveTwoRow = false/);
  assert.match(header, /const headerStyle:[\s\S]*?display:\s*"flex"[\s\S]*?alignItems:\s*"center"/);
  assert.match(header, /const subtitleStyle:[\s\S]*?textOverflow:\s*"ellipsis"[\s\S]*?whiteSpace:\s*"nowrap"/);
});
