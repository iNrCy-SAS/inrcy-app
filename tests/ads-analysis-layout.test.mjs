import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const phases = [
  "Lecture de votre iNrADN",
  "Objectif & conversion",
  "Ciblage intelligent",
  "Architecture de campagne",
  "Créations & messages",
  "Finalisation",
];

function fixture({ compact, ready }) {
  const rationale = "L’angle prioritaire retenu est la génération de prospects qualifiés via un formulaire instantané. Cette approche réduit la friction pour les professionnels et met en avant une offre d’essai claire. Le ciblage s’appuie sur les clients existants et les signaux de votre activité, tandis que les messages invitent à un premier échange simple. Une phase de lancement permet de mesurer la réponse réelle avant d’élargir l’audience et le budget.";
  const steps = Array.from({ length: 10 }, (_, index) => `<button><span>${index + 1}</span>${compact ? "" : ` Étape ${index + 1}`}</button>`).join("");
  const phaseCards = phases.map((label, index) => `<li data-state="${index === 0 ? "active" : "pending"}"><span>${index + 1}</span><div><strong>${label}</strong><small>Analyse de votre campagne</small></div></li>`).join("");
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
    ${css}
    </style></head><body><div style="height:76px"></div>
    <main class="workspace studioWorkspace" ${compact ? 'data-compact="true"' : 'style="height:calc(100vh - 76px)"'}>
      <nav class="stepper">${steps}</nav>
      <section class="card studioAnalysisCard"><div class="adsGenerationCanvas" ${ready ? 'data-ready="true"' : ""}>
        <div class="adsGenerationRadar"><span class="adsGenerationRadarSweep"></span><span class="adsGenerationRadarCore"></span></div>
        <span class="adsGenerationSatellite adsGenerationSatelliteLeft" aria-hidden="true"></span>
        <span class="adsGenerationSatellite adsGenerationSatelliteRight" aria-hidden="true"></span>
        <div class="adsGenerationEmblem"><span>↗</span></div>
        <p class="adsGenerationEyebrow">iNrCY · ANALYSE &amp; GÉNÉRATION</p>
        <h2>${ready ? "Votre campagne prend forme." : "iNrCy construit votre campagne."}</h2>
        <p class="adsGenerationLead">${ready ? "Votre base est prête. Contrôlez chaque recommandation avant de la diffuser." : "Nous relions votre iNrADN, vos priorités et l’historique utile pour vous proposer une campagne cohérente."}</p>
        <div class="adsGenerationProgress" ${ready ? "" : 'data-pending="true"'}><div><span style="width:22%"></span></div><strong>${ready ? "100%" : "Analyse en cours…"}</strong></div>
        <ol class="adsGenerationStages">${phaseCards}</ol>
        ${ready ? `<p class="studioMediaGenerationNote">iNr’Studio a généré et associé le média de cette campagne. Vous pourrez le remplacer, l’éditer ou le retirer à tout moment.</p><div class="studioPlanReady"><strong class="studioPlanHeading">Bilan de l’analyse</strong><details class="studioPlanDetails"><summary><span class="studioPlanPreview">${rationale}</span><span class="studioPlanExpandClosed">Lire le bilan complet ↓</span><span class="studioPlanExpandOpen">Réduire le bilan ↑</span></summary><p>${rationale}</p></details><div class="studioPlanSources"><span>Analyse basée sur</span><ul><li>iNrADN</li><li>documents de référence</li></ul></div></div>` : '<div class="studioPlanReady studioPlanPending" aria-hidden="true"><strong class="studioPlanHeading">Bilan de l’analyse</strong><div class="studioPlanPendingLines"><span></span><span></span><span></span></div></div>'}
      </div></section>
      <div class="wizardNavigation"><button>← Précédent</button><span>2 / 10</span><button>Proposition en cours…</button></div>
    </main></body></html>`;
}

test("analysis keeps all six phases aligned and visible on narrow phones", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[280, 568], [320, 568], [375, 667]]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
      try {
        await page.setContent(fixture({ compact: true, ready: false }));
        const layout = await page.evaluate(() => {
          const cards = [...document.querySelectorAll(".adsGenerationStages li")].map((element) => element.getBoundingClientRect());
          const nav = document.querySelector(".wizardNavigation").getBoundingClientRect();
          return { cards: cards.map(({ top, bottom, left, right }) => ({ top, bottom, left, right })), navBottom: nav.bottom };
        });
        const label = `${width}×${height}: ${JSON.stringify(layout)}`;
        assert.equal(layout.cards.length, 6, label);
        assert.ok(layout.cards[0].right <= layout.cards[1].left, label);
        assert.ok(layout.cards[2].right <= layout.cards[3].left, label);
        assert.ok(layout.cards[4].right <= layout.cards[5].left, label);
        assert.ok(layout.cards[0].top === layout.cards[1].top && layout.cards[2].top === layout.cards[3].top && layout.cards[4].top === layout.cards[5].top, label);
        assert.ok(layout.cards[5].bottom <= height, label);
        assert.ok(layout.navBottom <= height, label);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("desktop analysis frames the centered proposal with three phases on each side", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
      await page.setContent(fixture({ compact: false, ready: true }));
      const layout = await page.evaluate(() => {
        const stepper = document.querySelector(".stepper");
        const first = stepper.querySelector("button:first-child").getBoundingClientRect();
        const last = stepper.querySelector("button:last-child").getBoundingClientRect();
        const rail = stepper.getBoundingClientRect();
        const phases = [...document.querySelectorAll(".adsGenerationStages li")].map((element) => element.getBoundingClientRect());
        const title = document.querySelector(".adsGenerationCanvas h2").getBoundingClientRect();
        const note = document.querySelector(".studioMediaGenerationNote").getBoundingClientRect();
        const result = document.querySelector(".studioPlanReady").getBoundingClientRect();
        const card = document.querySelector(".studioAnalysisCard");
        const canvas = document.querySelector(".adsGenerationCanvas").getBoundingClientRect();
        const leftRadar = document.querySelector(".adsGenerationSatelliteLeft").getBoundingClientRect();
        const rightRadar = document.querySelector(".adsGenerationSatelliteRight").getBoundingClientRect();
        const centralSweep = getComputedStyle(document.querySelector(".adsGenerationRadarSweep"));
        return {
          groupCenter: (first.left + last.right) / 2,
          railCenter: (rail.left + rail.right) / 2,
          phases: phases.map(({ top, bottom, left, right }) => ({ top, bottom, left, right })),
          title: { left: title.left, right: title.right },
          note: { left: note.left, right: note.right, bottom: note.bottom },
          result: { left: result.left, right: result.right, bottom: result.bottom },
          cardScrollHeight: card.scrollHeight,
          cardClientHeight: card.clientHeight,
          canvas: { top: canvas.top, bottom: canvas.bottom, left: canvas.left, right: canvas.right },
          leftRadar: { top: leftRadar.top, bottom: leftRadar.bottom, left: leftRadar.left, right: leftRadar.right },
          rightRadar: { top: rightRadar.top, bottom: rightRadar.bottom, left: rightRadar.left, right: rightRadar.right },
          centralSweepRunning: centralSweep.animationPlayState === "running",
        };
      });
      assert.ok(Math.abs(layout.groupCenter - layout.railCenter) < 1, JSON.stringify(layout));
      assert.equal(layout.phases.length, 6);
      assert.ok(layout.phases.slice(0, 3).every((phase) => phase.right < layout.title.left), JSON.stringify(layout));
      assert.ok(layout.phases.slice(3).every((phase) => phase.left > layout.title.right), JSON.stringify(layout));
      assert.ok(layout.phases[0].top < layout.phases[1].top && layout.phases[1].top < layout.phases[2].top, JSON.stringify(layout));
      assert.ok(layout.phases[3].top < layout.phases[4].top && layout.phases[4].top < layout.phases[5].top, JSON.stringify(layout));
      assert.ok(layout.phases[0].top === layout.phases[3].top && layout.phases[1].top === layout.phases[4].top && layout.phases[2].top === layout.phases[5].top, JSON.stringify(layout));
      assert.ok(layout.phases[2].bottom <= layout.cardClientHeight + 80, JSON.stringify(layout));
      assert.ok(layout.cardScrollHeight <= layout.cardClientHeight + 1, `${width}×${height}: ${JSON.stringify(layout)}`);
      assert.ok(layout.leftRadar.left >= layout.canvas.left && layout.leftRadar.bottom < layout.phases[0].top, JSON.stringify(layout));
      assert.ok(layout.rightRadar.right <= layout.canvas.right && layout.rightRadar.top > layout.phases[5].bottom, JSON.stringify(layout));
      assert.ok(layout.leftRadar.top < layout.rightRadar.top && layout.centralSweepRunning, JSON.stringify(layout));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
