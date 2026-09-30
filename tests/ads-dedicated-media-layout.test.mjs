import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#2455aa"/><rect x="5" y="5" width="590" height="390" fill="none" stroke="white" stroke-width="10"/></svg>')}`;

function fixture(compact, legacyShrink = false) {
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}
    ${css}
    .drawerScroll{height:calc(100dvh - 76px);overflow-y:auto}
    @media(min-width:1000px) and (min-height:660px){.drawerScroll{overflow-y:hidden}}
    ${legacyShrink ? ".studioDedicatedMediaCard .campaignMediaWorkspace{flex:0 1 auto}" : ""}
    </style></head><body><header style="height:76px">Studio de campagne</header>
    <div class="drawerScroll" data-dashboard-settings-drawer-scroll="true"><main class="workspace studioWorkspace" ${compact ? 'data-compact="true"' : ""}>
      <nav class="stepper" aria-label="Étapes de création">${Array.from({ length: 9 }, (_, index) => `<button type="button"><span>${index + 1}</span>${compact ? "" : ` Étape ${index + 1}`}</button>`).join("")}</nav>
      <section class="card studioCard studioMediaCard studioDedicatedMediaCard" data-channel="linkedin" data-media-step="true">
        <header class="studioStepHeader"><span class="studioStepLabel">06 · MÉDIA LINKEDIN</span><h2><span class="studioTitleLong">Votre image sponsorisée, visible en entier.</span><span class="studioTitleShort">Votre média</span></h2><span class="studioStepChannel">LinkedIn Ads</span></header>
        <p class="intro studioOptionalIntro">Importez, générez ou choisissez l’image unique de votre Sponsored Content. L’aperçu conserve le cadrage complet et le fichier sera réimporté sous la Page sélectionnée avant la création.</p>
        <div class="studioGrid">
          <div class="field"><span>Format prévu : image sponsorisée</span><small>Choisissez un média cohérent ; ses droits et son format seront vérifiés avant toute publication.</small></div>
          <label class="field">Lien externe d’un média <small>Optionnel, HTTPS</small><input type="url" value="https://example.test/image.jpg" /></label>
          <label class="field studioWide">Consignes pour vos médias<textarea rows="3">Une image claire, sans recadrage, qui présente notre accompagnement.</textarea></label>
        </div>
        <div class="campaignMediaWorkspace">
          <div class="campaignMediaWorkspaceHeading"><div><span>MÉDIAS DE CAMPAGNE</span><strong>Un média est associé à cette campagne</strong></div><span data-type="image">Image prête</span></div>
          <div class="campaignMediaActions" data-three-actions="true"><button type="button"><span>▧</span>Ajouter une image</button><button type="button" class="campaignMediaGenerate"><span>✦</span>Générer</button><button type="button"><span>▦</span>Médiathèque</button></div>
          <div class="campaignMediaPreview"><img class="campaignMediaPreviewImage" src="${image}" alt="Image sponsorisée complète" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0" /></div>
          <div class="campaignMediaAttached"><span>✓</span><div><strong>Média associé à la campagne</strong><small>Image stockée dans votre médiathèque iNrCy.</small></div><a href="#media">Voir ↗</a><button type="button">Retirer</button></div>
          <p class="campaignMediaFormatHint">Le cadrage complet est conservé pour la vérification avant publication.</p>
        </div>
      </section>
      <nav class="wizardNavigation"><button type="button" class="back">← Précédent</button><span>6 / 9</span><button type="button" class="headerCta">Suivant →</button></nav>
    </main></div></body></html>`;
}

async function dimensions(page) {
  return page.evaluate(() => {
    const media = document.querySelector(".campaignMediaWorkspace");
    const preview = document.querySelector(".campaignMediaPreview");
    const card = document.querySelector(".studioDedicatedMediaCard");
    const footer = document.querySelector(".wizardNavigation");
    // scrollHeight includes an intentionally clipped decorative ::after ring.
    // Measure all real children plus bottom padding without altering the CSS.
    const mediaStyle = getComputedStyle(media);
    const contentBottom = Math.max(...Array.from(media.children, (element) => element.getBoundingClientRect().bottom))
      + parseFloat(mediaStyle.paddingBottom);
    const contentHeight = contentBottom - media.getBoundingClientRect().top - parseFloat(mediaStyle.borderTopWidth);
    const rect = (element) => {
      const { top, bottom, left, right, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, height };
    };
    return {
      clientHeight: media.clientHeight, scrollHeight: media.scrollHeight, contentHeight,
      media: rect(media), preview: rect(preview), card: rect(card), footer: rect(footer),
      footerOffset: footer.offsetTop,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

test("the dedicated media fixture detects the old desktop flex-shrink clipping", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1707, height: 842 } });
    await page.setContent(fixture(false, true));
    const layout = await dimensions(page);
    assert.ok(layout.clientHeight < layout.contentHeight - 100, JSON.stringify(layout));
    assert.ok(layout.preview.bottom > layout.media.bottom, "the old media box clips the preview before the containing card can reveal it");
  } finally { await browser.close(); }
});

test("dedicated campaign media stays complete and scrollable without moving the wizard footer", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1707, 842], [1440, 900], [1280, 720], [375, 667]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.setContent(fixture(width < 1000));
        await page.getByRole("img", { name: "Image sponsorisée complète" }).evaluate((element) => element.decode());
        const before = await dimensions(page);
        const label = `${width}×${height}: ${JSON.stringify(before)}`;
        assert.ok(before.clientHeight >= before.contentHeight - 2, `media workspace must not clip its own content — ${label}`);
        assert.equal(before.horizontalOverflow, false, label);
        await page.locator(".campaignMediaPreview").scrollIntoViewIfNeeded();
        const visible = await page.evaluate(() => {
          const preview = document.querySelector(".campaignMediaPreview").getBoundingClientRect();
          const image = document.querySelector(".campaignMediaPreviewImage");
          const bounds = image.getBoundingClientRect();
          const card = document.querySelector(".studioDedicatedMediaCard").getBoundingClientRect();
          const drawer = document.querySelector(".drawerScroll").getBoundingClientRect();
          return {
            previewTop: preview.top, previewBottom: preview.bottom,
            clipTop: Math.max(card.top, drawer.top), clipBottom: Math.min(card.bottom, drawer.bottom),
            imageInsidePreview: bounds.top >= preview.top && bounds.bottom <= preview.bottom && bounds.left >= preview.left && bounds.right <= preview.right,
            objectFit: getComputedStyle(image).objectFit,
          };
        });
        assert.ok(visible.previewTop >= visible.clipTop - 2 && visible.previewBottom <= visible.clipBottom + 2, `${width}×${height}: ${JSON.stringify(visible)}`);
        assert.equal(visible.imageInsidePreview, true);
        assert.equal(visible.objectFit, "contain");
        const remove = page.getByRole("button", { name: "Retirer", exact: true });
        await remove.scrollIntoViewIfNeeded();
        await remove.click({ trial: true });
        const after = await dimensions(page);
        assert.equal(after.footerOffset, before.footerOffset, "scrolling media must not reflow the footer");
        if (width >= 1000) {
          assert.equal(after.footer.top, before.footer.top, "desktop footer must stay fixed below the scrolling card");
          assert.ok(after.footer.bottom <= height + 2, "desktop footer must remain within the drawer");
        }
        assert.equal(after.horizontalOverflow, false);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
