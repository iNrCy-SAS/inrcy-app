import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

const home = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
  ${css}
  </style></head><body>
  <main class="page"><div class="shell">
    <header class="header"><div class="headerTop">
      <div class="headerBrand"><span class="brandMark"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" /></svg></span><div class="headerIdentity"><div class="headerTitleLine"><h1>iNr’<span>ADS</span></h1></div><p>Donnez de l’élan à votre visibilité.</p></div></div>
      <nav class="headerActions"><button class="trackingButton"><span class="headerActionIcon">☷</span><span class="headerActionText">Suivi des campagnes</span></button><a class="back headerCloseButton"><span class="headerActionIcon">×</span><span class="headerActionText">Fermer</span></a></nav>
    </div></header>
    <section class="channelCard"><div class="sectionHeading"><div><span>AMPLIFIEZ VOTRE PORTÉE</span><h2>Choisissez votre terrain de jeu.</h2></div></div>
      <nav class="channelRail">${["Meta", "Google", "LinkedIn", "TikTok", "Pinterest", "X"].map((name) => `<button data-near="true" aria-label="${name}"><span class="channelRailLogo">✦</span><span class="channelRailLabel">${name}</span></button>`).join("")}</nav>
      <div class="channelCarousel"><button aria-label="Canal précédent">‹</button><div class="cubeStage">
        <div class="channel channelMini"></div><div class="channel channelActive" data-provider="google"><span class="channelLogo"><span>◭</span></span><div class="channelIdentity"><strong>Google Ads</strong><small>Recherche · annonces textuelles</small><span class="channelStatus">Compte connecté</span></div><div class="channelActions"><a class="channelViewAccount">Voir le compte</a><button class="channelConfigure">Configurer</button></div></div><div class="channel channelMini"></div>
      </div><button aria-label="Canal suivant">›</button></div>
    </section>
    <div class="launchArea"><button class="headerCta launchButton"><span>✦</span> Lancer une campagne <span>↗</span></button></div>
  </div></main><div style="position:fixed;inset:auto 0 0;height:50px;background:#071126"></div>
  </body></html>`;

test("iNrADS mobile home keeps a square card, both arrows and the launch button visible", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[280, 568], [320, 480], [320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [650, 800]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      try {
        await page.setContent(home);
        const layout = await page.evaluate(() => {
          const [previous, next] = document.querySelectorAll(".channelCarousel>button");
          const active = document.querySelector(".cubeStage .channelActive");
          return {
            viewport: { width: innerWidth, height: innerHeight },
            card: rect(document.querySelector(".channelCard")),
            previous: rect(previous),
            next: rect(next),
            active: rect(active),
            action: rect(active.querySelector(".channelActions")),
            launch: rect(document.querySelector(".launchButton")),
          };
          function rect(element) {
            const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
            return { x, y, width, height, right, bottom };
          }
        });
        const label = `${width}×${height}: ${JSON.stringify(layout)}`;
        assert.ok(Math.abs(layout.active.width - layout.active.height) <= 1, `card must stay square — ${label}`);
        assert.ok(layout.previous.x >= layout.card.x && layout.next.right <= layout.card.right, `arrows must fit inside the panel — ${label}`);
        assert.ok(layout.previous.right <= layout.active.x && layout.active.right <= layout.next.x, `arrows must not be covered by the card — ${label}`);
        assert.ok(layout.action.bottom <= layout.active.bottom && layout.action.y >= layout.active.y, `card controls must fit — ${label}`);
        assert.ok(layout.launch.bottom <= height - 50 && layout.launch.y >= layout.card.bottom, `launch button must remain visible without scrolling — ${label}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
