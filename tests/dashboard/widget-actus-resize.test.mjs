import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const renderSource = readFileSync(resolve(root, "app/embed/actus/_lib/render.ts"), "utf8");
const snippetSource = readFileSync(resolve(root, "app/dashboard/_components/SiteActusWidgetCode.tsx"), "utf8");

function renderEmbedHtml() {
  const exports = {};
  const code = ts.transpileModule(renderSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks = {
    "@/lib/boosterFormatting": {
      renderBoosterSiteContentHtml: (raw) => String(raw).split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join(""),
    },
    "@/lib/boosterArticleCallCta": { parseBoosterArticleCallCta: () => null },
    "@/lib/embedActusMedia": {
      buildStableEmbedActusMediaUrl: ({ sourceUrl }) => sourceUrl,
      extractEmbedActusStorageReference: () => null,
    },
    "@/lib/imageInteractions": {
      getImageInteractionLinkHotspots: () => [],
      mergeImageInteractionOverlays: () => undefined,
      normalizeImageInteractions: () => undefined,
    },
  };
  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      assert.ok(id in mocks, `unexpected render import: ${id}`);
      return mocks[id];
    },
    Date,
    Intl,
    URL,
  });
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#c5d6c5"/></svg>');
  const portraitImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2000"><rect width="600" height="2000" fill="#d6c5c5"/></svg>');
  return exports.renderEmbedHtml({
    title: "Actualités",
    layout: "carousel",
    font: "site",
    design: "elegant",
    theme: "nature",
    frameId: "inrcy-actus-test-carousel",
    articles: [
      { title: "Une actualité très longue", content: Array.from({ length: 28 }, (_, i) => `Paragraphe ${i + 1} : ${"Une histoire du salon et de son équipe. ".repeat(8)}`).join("\n\n"), images: [image] },
      { title: "Une actualité courte", content: "Quelques nouvelles du salon.", images: [image] },
      { title: "Une grande photo", content: "Une photo verticale du salon.", images: [portraitImage] },
    ],
  });
}

function generatedSnippet(origin) {
  const start = snippetSource.indexOf("  return `<iframe id=");
  const end = snippetSource.indexOf("`;", start);
  assert.ok(start > 0 && end > start, "HTML snippet template must exist");
  const template = snippetSource.slice(start + "  return `".length, end);
  const makeSnippet = new Function("iframeId", "initialHeight", "publicAppOrigin", "htmlSrc", `return \`${template}\`;`);
  const snippet = makeSnippet("inrcy-actus-test-carousel", 560, origin, `${origin}/embed/actus`);
  const script = snippet.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "generated snippet must include a resize listener");
  assert.doesNotMatch(script, /&/, "WordPress can turn ampersands in inline scripts into HTML entities");
  // Reproduce the transformation seen in the public WordPress page.
  const wordpressScript = script.replaceAll("&", "&#038;");
  assert.doesNotThrow(() => new Function(wordpressScript));
  return snippet.replace(script, wordpressScript);
}

async function serve(html, hostSnippet) {
  let origin = "";
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url?.startsWith("/embed/actus")) response.end(html);
    else response.end(`<!doctype html><html><body style="margin:0"><main style="width:min(1028px,100%);margin:auto">${typeof hostSnippet === "function" ? hostSnippet(origin) : hostSnippet}</main></body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin };
}

async function heights(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    const frame = iframe.contentDocument;
    const root = frame.getElementById("root");
    return {
      outer: iframe.getBoundingClientRect().height,
      inner: root.getBoundingClientRect().height,
      viewport: frame.querySelector(".viewport").getBoundingClientRect().height,
      buttonBottom: frame.querySelector("[data-slide] .newsMore").getBoundingClientRect().bottom,
    };
  });
}

test("WordPress-safe snippet expands, collapses and switches slides without clipping", { skip: !existsSync(chromium.executablePath()) }, async () => {
  const html = renderEmbedHtml();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1200, 390]) {
      const { server, origin } = await serve(html, generatedSnippet);
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
        await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
        try {
          await page.goto(origin, { waitUntil: "domcontentloaded" });
          const frame = page.frameLocator("iframe");
          await page.waitForFunction(() => {
            const el = document.querySelector("iframe");
            const root = el?.contentDocument?.getElementById("root");
            return root && Math.abs(el.getBoundingClientRect().height - root.getBoundingClientRect().height) < 5;
          });
          const collapsed = await heights(page);
          await frame.locator("[data-slide]").first().locator(".newsMore").click();
          await page.waitForFunction(() => {
            const el = document.querySelector("iframe");
            const root = el?.contentDocument?.getElementById("root");
            return root && el.getBoundingClientRect().height > 1500 && el.getBoundingClientRect().height >= root.getBoundingClientRect().height - 2;
          });
          const expanded = await heights(page);
          assert.ok(expanded.outer > collapsed.outer + 500, `expanded iframe should grow at ${width}px`);
          assert.ok(expanded.buttonBottom <= expanded.outer, `Voir moins should be visible at ${width}px`);
          assert.equal(await frame.locator("[data-slide]").first().locator(".newsMore").textContent(), "Voir moins");
          await frame.locator("[data-slide]").first().locator(".newsMore").click();
          await page.waitForFunction((previous) => document.querySelector("iframe").getBoundingClientRect().height < previous - 500, expanded.outer);
          const reduced = await heights(page);
          assert.ok(reduced.outer < expanded.outer - 500, `collapsed iframe should shrink at ${width}px`);
          await frame.locator("[data-next]").click();
          await page.waitForFunction((previous) => document.querySelector("iframe").getBoundingClientRect().height < previous - 50, reduced.outer);
          const shortSlide = await heights(page);
          assert.ok(shortSlide.outer < reduced.outer, `short slide should not retain previous height at ${width}px`);
          await frame.locator("[data-next]").click();
          await page.waitForFunction((previous) => document.querySelector("iframe").getBoundingClientRect().height > previous + 300, shortSlide.outer);
          const portraitSlide = await heights(page);
          assert.ok(portraitSlide.outer >= portraitSlide.inner - 2, `portrait image should not be clipped at ${width}px`);
          await frame.locator("#root").evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 1700)));
          assert.equal(await frame.locator("#root.host-unavailable").count(), 0, "a connected host must not activate internal scrolling");
        } finally {
          await page.close();
        }
      } finally {
        await new Promise((done) => server.close(done));
      }
    }
  } finally {
    await browser.close();
  }
});

test("the installed fixed-height iframe keeps Voir moins reachable by wheel without a host script", { skip: !existsSync(chromium.executablePath()) }, async () => {
  const html = renderEmbedHtml();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, fixedHeight] of [[1200, 1100], [390, 1350]]) {
      const hostSnippet = `<iframe src="/embed/actus" width="100%" height="${fixedHeight}" scrolling="no" style="display:block;height:${fixedHeight}px;min-height:${fixedHeight}px;overflow:visible;border:0"></iframe>`;
      const { server, origin } = await serve(html, hostSnippet);
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
        await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
        try {
          await page.goto(origin, { waitUntil: "domcontentloaded" });
          const frame = page.frameLocator("iframe");
          await frame.locator("#root.host-unavailable").waitFor();
          await frame.locator("[data-slide]").first().locator(".newsMore").click();
          await page.waitForFunction(() => {
            const root = document.querySelector("iframe")?.contentDocument?.getElementById("root");
            return root && root.scrollHeight > root.clientHeight + 200;
          });
          const box = await page.locator("iframe").boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + 400);
          await page.mouse.wheel(0, 12000);
          await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.getElementById("root")?.scrollTop > 0);
          const afterScroll = await frame.locator(".newsMore").first().evaluate((button) => ({
            scrollTop: document.getElementById("root").scrollTop,
            buttonBottom: button.getBoundingClientRect().bottom,
            visibleHeight: window.innerHeight,
          }));
          assert.ok(afterScroll.buttonBottom <= afterScroll.visibleHeight, `Voir moins should be reachable at ${width}px without host resize: ${JSON.stringify(afterScroll)}`);
          await frame.locator("[data-slide]").first().locator(".newsMore").click();
          assert.equal(await frame.locator("[data-slide]").first().locator(".newsMore").textContent(), "Voir plus");
          await frame.locator("#root").evaluate((root) => root.scrollTo(0, 0));
          await frame.locator("[data-next]").click();
          await frame.locator("[data-next]").click();
          await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector(".viewport")?.getBoundingClientRect().height > 900);
          const portraitState = await frame.locator("#root").evaluate((root) => ({ scrollHeight: root.scrollHeight, clientHeight: root.clientHeight }));
          assert.ok(portraitState.scrollHeight > portraitState.clientHeight + 100, `portrait should overflow at ${width}px: ${JSON.stringify(portraitState)}`);
          await page.mouse.wheel(0, 12000);
          await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.getElementById("root")?.scrollTop > 0);
        } finally {
          await page.close();
        }
      } finally {
        await new Promise((done) => server.close(done));
      }
    }
  } finally {
    await browser.close();
  }
});
