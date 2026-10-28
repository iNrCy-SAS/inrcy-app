import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import ts from "typescript";
import { createInrBadgeQrMatrix } from "../../lib/inrBadgeQr.ts";
import { extractInrBadgeUserIdFromSlug } from "../../lib/inrBadge.ts";

type QrRoute = typeof import("../../app/api/public/directory/qr/[slug]/route");
const require = createRequire(import.meta.url);
const slug = "atelier-11111111111141118111111111111111";

function loadQrRoute(appOrigin: string): QrRoute {
  const source = readFileSync(new URL("../../app/api/public/directory/qr/[slug]/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const dependencies: Record<string, unknown> = {
    "@/lib/inrBadgeQr": { createInrBadgeQrMatrix },
    "@/lib/inrBadge": { extractInrBadgeUserIdFromSlug },
    "@/lib/inrDirectoryPublic": { directoryBadgeQrTarget: (value: string) => `${appOrigin}/badge/${value}?src=qr` },
  };
  new Function("require", "module", "exports", "process", code)((name: string) => {
    if (name === "next/server") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected QR dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env: { NODE_ENV: "production" } });
  return loaded.exports as QrRoute;
}

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function nextHeaderRules(): Promise<HeaderRule[]> {
  const source = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as { default?: { headers(): Promise<HeaderRule[]> } } };
  new Function("require", "module", "exports", "process", code)((name: string) => {
    if (name === "@sentry/nextjs") return { withSentryConfig: (config: unknown) => config };
    if (name === "next-intl/plugin") return { __esModule: true, default: () => (config: unknown) => config };
    if (name === "node:path") return require(name);
    assert.fail(`Unexpected Next configuration dependency: ${name}`);
  }, loaded, loaded.exports, { env: { NODE_ENV: "production" } });
  assert.ok(loaded.exports.default);
  return loaded.exports.default.headers();
}

test("Next applies the public QR exception after the global private resource policy", async () => {
  const rules = await nextHeaderRules();
  const qrRuleIndex = rules.findIndex(rule => rule.source === "/api/public/directory/qr/:slug");
  const privateRuleIndex = rules.findIndex(rule => rule.headers.some(header => header.key === "Cross-Origin-Resource-Policy" && header.value === "same-origin"));
  assert.ok(privateRuleIndex >= 0, "the default private resource policy remains configured");
  assert.ok(qrRuleIndex > privateRuleIndex, "the scoped QR rule must win when both rules match");
  assert.deepEqual(rules[qrRuleIndex].headers, [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }]);
  const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp(source: string): RegExp };
  const policyFor = (pathname: string) => rules.reduce((policy, rule) => pathToRegexp(rule.source).test(pathname)
    ? rule.headers.find(header => header.key === "Cross-Origin-Resource-Policy")?.value || policy : policy, "");
  assert.equal(policyFor(`/api/public/directory/qr/${slug}`), "cross-origin");
  for (const pathname of ["/api/profile", "/dashboard", "/api/public/directory", "/api/public/directory/qr-extra/private.svg"]) {
    assert.equal(policyFor(pathname), "same-origin", `${pathname} keeps its existing resource policy`);
  }
});

test("WordPress-style cross-origin img decodes the actual public QR while the private policy still blocks a control", async () => {
  let appOrigin = "";
  const appServer = createServer((request, response) => {
    void (async () => {
      const result = await qrRoute.GET({ nextUrl: new URL(request.url || "/", appOrigin) } as Parameters<QrRoute["GET"]>[0], { params: Promise.resolve({ slug }) });
      // Model the global Next.js header followed by the route's explicit response.
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      result.headers.forEach((value, key) => response.setHeader(key, value));
      if (request.url === "/private-control.svg") response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      response.writeHead(result.status);
      response.end(await result.text());
    })().catch(error => { response.writeHead(500); response.end(String(error)); });
  });
  const pageServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<html><body><img id="qr" src="${appOrigin}/api/public/directory/qr/${slug}" width="140" height="140" alt="QR iNr’Badge"><img id="control" src="${appOrigin}/private-control.svg" width="140" height="140" alt="Private control"></body></html>`);
  });
  appOrigin = await listen(appServer);
  const qrRoute = loadQrRoute(appOrigin);
  const pageOrigin = await listen(pageServer);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pageOrigin, { waitUntil: "load" });
    const images = await page.locator("img").evaluateAll(elements => elements.map(element => {
      const image = element as HTMLImageElement;
      return { id: image.id, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
    }));
    const qr = images.find(image => image.id === "qr");
    const control = images.find(image => image.id === "control");
    assert.ok(qr && control);
    assert.equal(qr.complete, true);
    assert.ok(qr.width > 0 && qr.height > 0, "the public SVG must decode across origins, not merely return HTTP 200");
    assert.equal(control.complete, true);
    assert.equal(control.width, 0, "same-origin protection still blocks the private control");
  } finally {
    await browser?.close();
    await Promise.all([close(appServer), close(pageServer)]);
  }
});
