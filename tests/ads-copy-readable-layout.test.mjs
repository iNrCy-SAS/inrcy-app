import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = (await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8"))
  .replace(/:global\(([^)]+)\)/g, "$1");

function copyField(label, max, count) {
  const value = max === 30 ? "Votre artisan près de chez vous" : "Un accompagnement local pour votre projet. Contactez notre équipe pour un devis gratuit.";
  return `<fieldset class="field googleAdCopyField"><legend>${label}</legend><small>${max} caractères maximum</small><div class="googleAdCopyRows">${Array.from({ length: Math.min(count, 5) }, (_, index) => `<div class="googleAdCopyRow"><label for="${label}-${index}">${label} ${index + 1}</label><textarea class="campaignTextarea" id="${label}-${index}" rows="${max === 30 ? 1 : 2}">${value}</textarea><span>${value.length}/${max}</span><button>×</button></div>`).join("")}</div>${count > 5 ? '<nav class="googleAdCopyPagination"><button>←</button><span>1–5 sur 15</span><button>→</button></nav>' : max === 30 ? '<button class="googleAdCopyAdd">+ Ajouter un titre</button>' : ""}</fieldset>`;
}

function fixture(count = 5, targeting = false) {
  const tag = (label, values) => `<div class="field tagField"><span>${label}</span><small>Ajoutez un choix</small><div class="tagInputShell">${values.map((value) => `<button class="tagChip"><span>${value}</span><span>×</span></button>`).join("")}<input placeholder="Ajouter un choix…"><button class="tagAddButton">Ajouter</button></div></div>`;
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}${css}.drawer{height:calc(100dvh - 76px);overflow:auto}</style></head><body><header style="height:76px">Studio de campagne</header><div class="drawer" data-dashboard-settings-drawer-scroll="true"><main class="workspace studioWorkspace"><nav class="stepper"><button><span>1</span>Fondations</button><button><span>2</span>Ciblage</button><button><span>3</span>Créations</button></nav><section class="card studioCard ${targeting ? "studioTargetingCard" : "studioCreativeCard"}" data-channel="google"><header class="studioStepHeader"><span class="studioStepLabel">CRÉATIONS</span><h2>Des messages qui donnent envie d’agir.</h2><span class="studioStepChannel">Google Ads</span></header><p class="intro studioOptionalIntro">Relisez les messages de votre campagne avant sa publication.</p><div class="studioGrid">${targeting ? `${tag("Zones ciblées", ["Arras", "Lille", "Valenciennes"])}${tag("Audiences", ["Professionnels indépendants", "Responsables communication de petites structures"])}${tag("Langues", ["fr"])}` : `<label class="field studioWide">Message principal<div class="voiceTextarea"><textarea class="campaignTextarea" rows="2">Un artisan proche de chez vous pour concrétiser votre projet. Demandez votre devis gratuit.</textarea></div></label>${copyField("Titre", 30, count)}${copyField("Description", 90, 4)}<label class="field">Appel à l’action<input value="Demander un devis"></label><aside class="studioCopyGuidance field"><strong>À vérifier</strong><p>Les phrases doivent être complètes et respecter la limite.</p></aside>`}</div></section><nav class="wizardNavigation"><button class="back">Précédent</button><span>6 / 9</span><button class="headerCta">Suivant →</button></nav></main></div></body></html>`;
}

async function setFixture(page, html) {
  await page.setContent(html.replace('class="field studioWide">Message', 'class="field studioWide studioMessageField">Message').replace('class="field">Appel', 'class="field studioCtaField">Appel'));
  await page.locator(".studioWorkspace").evaluate((element, width) => {
    if (width < 1000) element.setAttribute("data-compact", "true");
  }, page.viewportSize().width);
  await page.locator("textarea").evaluateAll((elements) => elements.forEach((element) => {
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight + 2}px`;
  }));
}

test("ordinary desktop copy and targeting fit without nested scrolling; all copy remains readable", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1366, 768], [1440, 900], [1707, 842], [1920, 1080]]) {
      for (const targeting of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height } });
        await setFixture(page, fixture(5, targeting));
        const result = await page.evaluate(() => {
          const card = document.querySelector(".studioCard");
          return {
            cardScroll: card.scrollHeight - card.clientHeight,
            copyScroll: [...document.querySelectorAll(".googleAdCopyRows,textarea")].some((el) => el.scrollHeight > el.clientHeight + 2),
            footerBottom: document.querySelector(".wizardNavigation").getBoundingClientRect().bottom,
            horizontal: document.documentElement.scrollWidth > innerWidth,
            chipClipped: [...document.querySelectorAll(".tagChip>span:first-child")].some((el) => el.scrollWidth > el.clientWidth + 1),
          };
        });
        const context = `${width}×${height} targeting=${targeting} ${JSON.stringify(result)}`;
        assert.ok(result.cardScroll <= 2, context);
        assert.equal(result.copyScroll, false, context);
        assert.ok(result.footerBottom <= height, context);
        assert.equal(result.horizontal, false, context);
        assert.equal(result.chipClipped, false, context);
        await page.close();
      }
    }
    for (const [width, height] of [[320, 568], [375, 667], [768, 1024], [1024, 768], [1366, 768], [1707, 842]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await setFixture(page, fixture(15));
      assert.equal(await page.locator(".googleAdCopyRows").first().evaluate((el) => el.scrollHeight <= el.clientHeight + 2), true, "15 titles must use the one card/page fallback, never a nested list scroller");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator("textarea").evaluateAll((elements) => elements.every((element) => element.scrollHeight <= element.clientHeight + 2 && element.scrollWidth <= element.clientWidth + 2)), true, `${width}: every complete phrase stays visible in its textarea`);
      if (width >= 1000) assert.ok((await page.locator(".wizardNavigation").boundingBox()).y < height, "desktop navigation stays visible with many titles");
      if (width >= 1280) assert.equal(await page.locator(".studioCard").evaluate((el) => el.scrollHeight <= el.clientHeight + 2), true, "paginated copy fits the desktop card with 15 titles");
      for (const control of [page.locator("textarea").first(), page.locator("textarea").last(), page.locator(".googleAdCopyPagination button").last(), page.getByRole("button", { name: "Suivant →", exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        assert.equal(await control.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1 && (top === element || element.contains(top));
        }), true, `${width}: copy field or next button is obscured`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
