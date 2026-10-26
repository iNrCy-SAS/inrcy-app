import { expect, test, type Page } from "@playwright/test";

const bubbleSelector = "[data-inrcy-tooltip-bubble]";

/** Real root provider on a public page; fixture controls never call an API. */
async function fixture(page: Page, html: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((markup) => {
    const fixture = document.createElement("div");
    fixture.id = "tooltip-fixture";
    fixture.style.cssText = "position:fixed;inset:90px 20px auto;z-index:200000;display:flex;gap:30px;padding:20px;background:#10213f;color:white";
    fixture.innerHTML = markup;
    document.body.append(fixture);
  }, html);
  await expect(page.locator("html")).toHaveAttribute("data-inrcy-tooltips-ready", "");
}

test("native titles become one designed tooltip while accessible names remain intact", async ({ page }) => {
  await fixture(page, '<button id="icon" title="Réglages du canal">⚙</button><button id="named" aria-label="Ouvrir le planning" title="Planning des publications">▦</button><iframe title="Aperçu du document" hidden></iframe>');
  await expect(page.getByRole("button", { name: "Réglages du canal", exact: true })).toBeVisible();
  await expect(page.locator("#icon")).toHaveAttribute("title", "");
  await expect(page.getByRole("button", { name: "Ouvrir le planning", exact: true })).toBeVisible();
  await expect(page.locator("#tooltip-fixture iframe")).toHaveAttribute("title", "");
  await expect(page.locator("#tooltip-fixture iframe")).toHaveAttribute("aria-label", "Aperçu du document");
  await page.locator("#icon").hover();
  const bubble = page.locator(bubbleSelector);
  await expect(bubble).toHaveText("Réglages du canal");
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toHaveCSS("pointer-events", "none");
  expect(await bubble.evaluate((element) => element.parentElement === document.body)).toBe(true);
});

test("text buttons have no duplicate tooltip on hover or keyboard focus", async ({ page }) => {
  await fixture(page, '<button id="before">Avant</button><button id="close" title="Fermer">Fermer</button><button id="next" title="Continuer">Continuer →</button><button id="save" title="Enregistrer">💾 Enregistrer</button><button id="old-css" data-tooltip="Fermer">Fermer</button>');
  for (const id of ["close", "next", "save", "old-css"]) {
    await page.locator(`#${id}`).hover();
    await page.waitForTimeout(430);
    await expect(page.locator(bubbleSelector)).toHaveCount(0);
    await expect(page.locator(`#${id}`)).not.toHaveAttribute("aria-description");
  }
  await page.locator("#before").focus(); await page.keyboard.press("Tab");
  await expect(page.locator("#close")).toBeFocused();
  await page.waitForTimeout(130);
  await expect(page.locator(bubbleSelector)).toHaveCount(0);
});

test("icon labels, useful explanations and clipped text keep their tooltip", async ({ page }) => {
  await fixture(page, '<button id="icon-close" title="Fermer"><svg width="20" height="20"><title>Fermer</title><path d="M2 2L18 18M18 2L2 18" stroke="white"/></svg></button><button id="helpful" title="Enregistrer" data-tooltip-description="Conserve le brouillon sans le publier.">Enregistrer</button><button id="clipped" title="Document commercial très long" style="width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Document commercial très long</button><button id="hidden" title="Fermer"><span hidden>Fermer</span>×</button>');
  const bubble = page.locator(bubbleSelector);
  for (const [id, text] of [["icon-close", "Fermer"], ["helpful", "Conserve le brouillon sans le publier."], ["clipped", "Document commercial très long"], ["hidden", "Fermer"]]) {
    await page.locator(`#${id}`).hover();
    await expect(bubble).toContainText(text);
  }
});

test("keyboard focus opens the tooltip, Escape closes it and clicks reach the control", async ({ page }) => {
  await fixture(page, '<button id="before">Avant</button><button id="action" title="Ouvrir le studio" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">✦</button>');
  await page.locator("#before").focus();
  await page.keyboard.press("Tab");
  const bubble = page.locator(bubbleSelector);
  await expect(bubble).toHaveText("Ouvrir le studio");
  const id = await bubble.getAttribute("id");
  await expect(page.locator("#action")).toHaveAttribute("aria-describedby", id!);
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(page.locator("#action")).not.toHaveAttribute("aria-describedby");
  await page.locator("#action").click();
  await expect(page.locator("#action")).toHaveAttribute("data-clicks", "1");
});

test("dynamic titles update and metadata replaces older local CSS bubbles", async ({ page }) => {
  await fixture(page, '<style>#dynamic::after{content:attr(data-tooltip);display:block}</style><button id="dynamic" title="Ancien libellé" data-tooltip="Créer" data-tooltip-description="Préparez votre prochaine publication.">＋</button>');
  await page.locator("#dynamic").hover();
  const bubble = page.locator(bubbleSelector);
  await expect(bubble).toContainText("Créer");
  await expect(bubble).toContainText("Préparez votre prochaine publication.");
  expect(await page.locator("#dynamic").evaluate((element) => getComputedStyle(element, "::after").display)).toBe("none");
  await page.locator("#dynamic").evaluate((element) => {
    element.removeAttribute("data-tooltip");
    element.removeAttribute("data-tooltip-description");
    element.setAttribute("title", "Nouveau libellé");
  });
  await expect(bubble).toHaveText("Nouveau libellé");
  await expect(page.locator("#dynamic")).toHaveAttribute("aria-label", "Nouveau libellé");
  await page.locator("#dynamic").evaluate((element) => element.removeAttribute("title"));
  await expect(bubble).toHaveCount(0);
  await expect(page.locator("#dynamic")).not.toHaveAttribute("aria-label");
});

test("portal stays inside the viewport above clipped content", async ({ page }) => {
  await fixture(page, '<div style="position:fixed;right:1px;top:1px;width:40px;height:30px;overflow:hidden"><button id="edge" title="Un libellé suffisamment long pour vérifier le placement au bord de l’écran">?</button></div>');
  await page.locator("#edge").hover();
  const bubble = page.locator(bubbleSelector);
  await expect(bubble).toBeVisible();
  const box = await bubble.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(11);
  expect(box!.y).toBeGreaterThanOrEqual(11);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 11);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 11);
});

test("scroll, SPA navigation and removing the source dismiss stale tooltips", async ({ page }) => {
  await fixture(page, '<button id="transient" title="Voir les statistiques">◉</button>');
  const anchor = page.locator("#transient");
  const bubble = page.locator(bubbleSelector);
  await anchor.hover();
  await expect(bubble).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
  await expect(bubble).toHaveCount(0);
  await page.mouse.move(1, 1);
  await anchor.hover();
  await expect(bubble).toBeVisible();
  await page.evaluate(() => history.pushState({}, "", "?tooltip-navigation-test"));
  await expect(bubble).toHaveCount(0);
  await page.mouse.move(1, 1);
  await anchor.hover();
  await expect(bubble).toBeVisible();
  await anchor.evaluate((element) => element.remove());
  await expect(bubble).toHaveCount(0);
});

test("touching or focusing after a touch never opens a hover tooltip", async ({ page }) => {
  await fixture(page, '<button id="touch" title="Réglages">⚙</button>');
  await page.locator("#touch").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    (element as HTMLButtonElement).focus();
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
  });
  await page.waitForTimeout(500);
  await expect(page.locator(bubbleSelector)).toHaveCount(0);
});

test("native dialogs keep tooltips above their top layer and Escape only dismisses the tooltip", async ({ page }) => {
  await fixture(page, '<dialog id="native"><button id="dialog-action" title="Choisir un document">＋</button></dialog>');
  await page.locator("#native").evaluate((element) => (element as HTMLDialogElement).showModal());
  await page.locator("#dialog-action").hover();
  const bubble = page.locator(bubbleSelector);
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((element) => element.parentElement?.id)).toBe("native");
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(page.locator("#native")).toHaveAttribute("open", "");
});
