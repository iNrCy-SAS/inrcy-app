import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const themes = {
  meta: { label: "Meta Ads", accent: "#b5d9ff", rgb: "rgb(181, 217, 255)", button: "rgb(36, 76, 169)" },
  openai: { label: "ChatGPT Ads", accent: "#95e4dd", rgb: "rgb(149, 228, 221)", button: "rgb(18, 97, 95)" },
  x: { label: "X Ads", accent: "#f1f1f1", rgb: "rgb(241, 241, 241)", button: "rgb(52, 52, 52)" },
  tiktok: { label: "TikTok Ads", accent: "#66eee9", rgb: "rgb(102, 238, 233)", button: "rgb(19, 88, 94)" },
};

function fixture(channel, compact, stepCount, geography = false) {
  const longUrl = "https://example.com/une-offre-pour-les-petites-entreprises?utm_source=" + channel + "&utm_campaign=essai-gratuit-professionnel";
  const draftOnly = channel === "x" || channel === "tiktok";
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#08111a}
    ${css.replace(/:global\(([^)]+)\)/g, "$1")}
    .fixtureCanvas{width:calc(100% - 128px);height:calc(100dvh - 220px);margin:130px auto 0;padding:0}
    @media(max-width:999px){.fixtureCanvas{width:100%;height:auto;margin:0;padding:12px}}
    </style></head><body><main class="workspace studioWorkspace fixtureCanvas" data-channel="${channel}" ${compact ? 'data-compact="true"' : ""}>
      <nav class="stepper" aria-label="Étapes de création">${Array.from({ length: stepCount }, (_, index) => `<button type="button" ${index === stepCount - 1 ? 'aria-current="step"' : ""} aria-label="Étape ${index + 1}"><span>${index + 1}</span></button>`).join("")}</nav>
      <section class="card studioCard ${geography ? "studioTargetingCard" : "studioValidationCard"}" data-channel="${channel}" ${geography ? `data-${channel}-geography="true"` : ""}>
        <header class="studioStepHeader"><span class="studioStepLabel">VOTRE CONTRÔLE</span><h2>${geography ? "Zones géographiques" : draftOnly ? "Vérifier le brouillon" : "Vérifier et lancer"}</h2><span class="studioStepChannel">${themes[channel].label}</span></header>
        ${geography ? `<div class="studioGrid"><div class="studioLocationField"><label class="field">Zones ciblées<input value="Hauts-de-France, France" /></label></div><fieldset class="studioControlPanel"><legend>Choisir un territoire exact</legend><label class="field">Zones disponibles<select><option>Hauts-de-France, France</option><option>Île-de-France, France</option></select></label></fieldset></div>` : `
        <dl class="studioReviewGrid"><div><dt>Compte publicitaire</dt><dd>Entreprise indépendante</dd></div><div><dt>Destination et suivi</dt><dd>${longUrl}</dd></div><div><dt>Budget</dt><dd>200,00 € au total</dd></div></dl>
        <label class="check studioRequiredCheck"><input type="checkbox"><span><strong>${draftOnly ? "Réglages relus" : "Budget et diffusion"}</strong>${draftOnly ? "Je confirme la préparation de ce brouillon." : "J’autorise cette campagne sur le compte indiqué avec le budget et la période relus."}</span></label>
        <div class="studioFinalActions"><button type="button" class="primaryButton">${draftOnly ? "Enregistrer en brouillon" : "VALIDER"}</button></div>`}
      </section>
    </main></body></html>`;
}

function contrast(left, right) {
  const luminance = (hex) => {
    const rgb = hex.trim().replace("#", "").match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const first = luminance(left), second = luminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("Meta, ChatGPT, X et TikTok gardent leur palette propre, un récapitulatif pleine largeur et treize étapes accessibles", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1366, 768], [1707, 842]]) {
      for (const channel of ["meta", "openai", "x", "tiktok"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.setContent(fixture(channel, width < 1000, 13));
          const layout = await page.evaluate(() => {
            const workspace = document.querySelector(".studioWorkspace");
            const card = document.querySelector(".studioValidationCard");
            const stepper = document.querySelector(".stepper");
            const styles = getComputedStyle(workspace);
            const contentWidth = workspace.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
            return {
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
              stepperWidth: stepper.clientWidth, stepperScrollWidth: stepper.scrollWidth,
              cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth, contentWidth,
              headerColor: getComputedStyle(document.querySelector(".studioStepLabel")).color,
              accent: styles.getPropertyValue("--ads-studio-accent"),
              start: styles.getPropertyValue("--ads-studio-surface-start"), end: styles.getPropertyValue("--ads-studio-surface-end"),
              buttonStart: styles.getPropertyValue("--ads-studio-button-start"), buttonEnd: styles.getPropertyValue("--ads-studio-button-end"),
              spectrum: styles.getPropertyValue("--ads-studio-spectrum"),
              gradient: getComputedStyle(document.querySelector(".primaryButton")).backgroundImage,
            };
          });
          const context = `${channel} ${width}×${height}: ${JSON.stringify(layout)}`;
          assert.equal(layout.pageOverflow, false, context);
          assert.ok(layout.stepperScrollWidth <= layout.stepperWidth + 1, context);
          assert.ok(layout.cardScrollWidth <= layout.cardWidth + 1, context);
          assert.ok(Math.abs(layout.cardWidth - layout.contentWidth) <= 3, context);
          assert.equal(layout.accent.trim(), themes[channel].accent, context);
          assert.equal(layout.headerColor, themes[channel].rgb, context);
          assert.ok(layout.gradient.includes(themes[channel].button), context);
          if (channel === "tiktok") { assert.match(layout.spectrum, /#25f4ee/); assert.match(layout.spectrum, /#fe2c55/); }
          if (channel === "x") { assert.match(layout.spectrum, /#f5f5f5/); assert.match(layout.spectrum, /#777777/); }
          for (const background of [layout.start, layout.end]) assert.ok(contrast(layout.accent, background) >= 4.5, `Accent du titre illisible : ${context}`);
          for (const background of [layout.buttonStart, layout.buttonEnd]) assert.ok(contrast("#ffffff", background) >= 4.5, `Libellé du bouton illisible : ${context}`);
          assert.match(layout.gradient, /linear-gradient/, context);
          for (const control of [page.getByRole("checkbox"), page.getByRole("button", { name: channel === "x" || channel === "tiktok" ? "Enregistrer en brouillon" : "VALIDER", exact: true })]) {
            await control.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
            const visible = await control.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
              return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && (element === top || element.contains(top));
            });
            assert.equal(visible, true, context);
          }
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});

test("Les étapes géographiques X et TikTok utilisent toute la largeur sans modifier les autres grilles", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1366, 768], [1707, 842]]) for (const channel of ["x", "tiktok"]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.setContent(fixture(channel, width < 1000, 11, true));
        const layout = await page.evaluate(() => {
          const card = document.querySelector(".studioTargetingCard"), grid = card.querySelector(".studioGrid");
          const styles = getComputedStyle(grid);
          return { width: innerWidth, page: document.documentElement.scrollWidth, card: card.clientWidth, scroll: card.scrollWidth,
            grid: grid.clientWidth, children: [...grid.children].map((child) => child.getBoundingClientRect().width),
            columns: styles.gridTemplateColumns.trim().split(/\s+/).length };
        });
        const context = `${channel} géographie ${width}×${height}: ${JSON.stringify(layout)}`;
        assert.ok(layout.page <= layout.width + 1, context); assert.ok(layout.scroll <= layout.card + 1, context);
        assert.equal(layout.columns, 1, context);
        assert.ok(layout.children.every((child) => Math.abs(child - layout.grid) <= 3), context);
        for (const control of await page.locator(".studioTargetingCard input,.studioTargetingCard select").all()) {
          await control.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
          assert.equal(await control.evaluate((element) => { const bounds = element.getBoundingClientRect(); const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && (top === element || element.contains(top)); }), true, context);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
