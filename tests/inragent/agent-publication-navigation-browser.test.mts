import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createElement, Fragment, type FunctionComponent } from "react";
import { channelNodes } from "../helpers/channel-bubble-runtime.mts";
import { responsiveSurfaceFixture } from "../helpers/responsive-surface-fixture.mts";

const navigationFile = "app/dashboard/agent/_components/AgentPublicationNavigation.tsx";

test("cliquer le libellé et cocher la case déclenchent deux actions distinctes", () => {
  const fixture = responsiveSurfaceFixture("fr-FR");
  const Navigation = fixture.load(navigationFile).default as FunctionComponent<Record<string, unknown>>;
  const calls: unknown[][] = [];
  const filters = { validated: false, pending: true, creating: false, refused: false };
  const nodes = channelNodes(Navigation({
    current: 1, total: 1, filters, counts: { validated: 3, pending: 1, creating: 2, refused: 0 },
    onFilterFocus: (state: string) => calls.push(["focus", state]),
    onFilterChange: (state: string, checked: boolean) => calls.push(["change", state, checked]),
  }) as ReturnType<typeof createElement>);
  for (const state of Object.keys(filters)) {
    const group = nodes.find(node => node.props["data-state"] === state)!;
    const children = channelNodes(group);
    const button = children.find(node => node.type === "button")!;
    const input = children.find(node => node.type === "input")!;
    assert.equal(button.props["aria-pressed"], state === "pending");
    if (state === "pending") assert.equal(button.props.title, "Afficher tous les statuts");
    (button.props.onClick as () => void)();
    (input.props.onChange as (event: { currentTarget: { checked: boolean } }) => void)({ currentTarget: { checked: false } });
    assert.deepEqual(calls.splice(0), [["focus", state], ["change", state, false]]);
  }
});

test("les quatre filtres de publication restent lisibles, colorés et accessibles au clavier", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const locale of ["fr-FR", "de-DE"]) {
      const fixture = responsiveSurfaceFixture(locale);
      const workspace = fixture.stylesheet("app/dashboard/agent/agent.module.css");
      const props = {
        current: 5, total: 111, canNavigate: true, onMove: fixture.noop,
        counts: { validated: 1, pending: 12, creating: 98, refused: 0 },
        filters: { validated: true, pending: true, creating: true, refused: true },
        disabled: false, onFilterFocus: fixture.noop, onFilterChange: fixture.noop,
      };
      const render = (disabled = false) => fixture.markup(createElement(Fragment, null,
        fixture.element(navigationFile, { ...props, disabled }),
        ...Object.keys(props.filters).map(state => createElement("div", {
          key: state, className: workspace.publishFooterStatus, "data-validation-state": state,
        }, createElement("span", { className: workspace.publishFooterStatusText }, createElement("strong", null, state)))),
      ), workspace.agentWorkspace);
      const html = render();
      for (const width of [320, 390, 768, 1151, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(html);
        const geometry = await page.locator("fieldset [data-state]").evaluateAll(labels => {
          const nav = document.querySelector("nav")!.getBoundingClientRect();
          return labels.map(label => {
            const rect = label.getBoundingClientRect();
            return {
              state: label.getAttribute("data-state"),
              accent: getComputedStyle(label.querySelector("input")!).accentColor,
              fits: rect.left >= 0 && rect.right <= innerWidth,
              clearsNav: rect.left >= nav.right || rect.top >= nav.bottom,
            };
          });
        });
        assert.deepEqual(geometry.map(item => item.state), ["validated", "pending", "creating", "refused"]);
        assert.deepEqual(geometry.map(item => item.accent), ["rgb(105, 223, 161)", "rgb(131, 186, 255)", "rgb(246, 212, 94)", "rgb(255, 136, 141)"]);
        const footerColors = await page.locator("[data-validation-state] strong").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
        assert.deepEqual(footerColors, geometry.map(item => item.accent));
        assert.ok(geometry.every(item => item.fits && item.clearsNav), locale + " " + width + "px");
      }
      if (locale === "fr-FR") {
        const group = page.getByRole("group", { name: "Filtrer les publications par statut" });
        await page.getByRole("navigation").getByRole("button").last().focus();
        for (const name of ["Validée (1)", "À valider (12)", "En création (98)", "Refusée (0)"]) {
          const button = group.getByRole("button", { name, exact: true });
          const checkbox = group.getByRole("checkbox", { name, exact: true });
          assert.ok(await checkbox.isChecked(), name);
          await page.keyboard.press("Tab");
          assert.ok(await button.evaluate(element => element.matches(":focus-visible")), name);
          await page.keyboard.press("Tab");
          assert.ok(await checkbox.evaluate(input => input.matches(":focus-visible")), name);
          await page.keyboard.press("Space");
          assert.equal(await checkbox.isChecked(), false, name);
        }
        await page.setContent(render(true));
        assert.equal(await page.locator('input[type="checkbox"]:disabled').count(), 4);
        assert.equal(await page.locator("fieldset button:disabled").count(), 4);
      }
    }
  } finally {
    await browser.close();
  }
});
