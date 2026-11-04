import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const longStrengths = [
  "Univers littéraire fondé sur la curiosité, l’observation et la réflexion dans les échanges personnels et professionnels",
  "Capacité à aborder des thèmes personnels et relationnels à travers des textes courts, des récits et des formules réflexives",
  "Présence éditoriale sur plusieurs réseaux sociaux pour partager de nouvelles perspectives avec les lecteurs",
  "Livre annoncé comme disponible dans le réseau de librairies, auprès des libraires indépendants et sur plusieurs plateformes en ligne",
  "Univers littéraire clairement associé à la curiosité, à l’observation et au changement de regard sur les relations humaines",
];

function identitySource() {
  const source = ts.createSourceFile("page.tsx", read("app/entreprises/[slug]/page.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let universe: ts.JsxElement | undefined;
  let renderFact: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "renderPresentationFact") renderFact = node.initializer;
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
      && attribute.name.getText(source) === "className" && attribute.initializer?.getText(source) === "{styles.presentationUniverse}")) universe = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(universe && renderFact, "Use the actual identity markup and fact renderer");
  return compile(`const React=require('react'),styles=require('./inrSearchPublic.module.css').default;
    exports.default=function Identity(){
      const data={companyName:'Christophe Auteur — Récits et réflexions pour changer de regard',city:'Montpellier',profession:'Écrivain / Auteur',sectorLabel:'Culture',logoUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>'};
      const facts=[{kind:'activity',icon:'sparkles',label:'Activity',value:data.profession,href:''},{kind:'anchor',icon:'pin',label:'Anchor',value:data.city,href:''},
        {kind:'strengths',icon:'sparkles',label:'Strengths',value:${JSON.stringify(longStrengths.join(" · "))},href:''},
        {kind:'availability',icon:'clock',label:'Availability',value:'Sur rendez-vous du lundi au samedi, avec des disponibilités adaptées aux besoins de chaque lecteur et aux événements littéraires de la région.',href:''}];
      const hasStrengthFact=true,hasAvailabilityFact=true,Icon=()=>React.createElement('span',null,'✦'),i18nT=(key,values={})=>Object.values(values).join(' ')||key;
      const InrSearchLogo=props=>React.createElement('img',{src:props.src,alt:props.alt,width:props.width,height:props.height});
      const renderPresentationFact=${renderFact.getText(source)};
      return <div className={styles.presentationStage}><div className={styles.presentationLayout}><div className={styles.presentationCopy}><h1 className={styles.presentationTitle}>{data.companyName}</h1></div>${universe.getText(source)}</div></div>;
    };`);
}

async function setup(page: Page) {
  const sources = {
    react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
    "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
    scheduler: packageSource("scheduler", "scheduler.production.js"),
    identity: identitySource(),
    zone: compile(read("app/entreprises/[slug]/InrSearchZoneOrbit.tsx")),
    strengths: compile(read("app/entreprises/[slug]/InrSearchStrengthsOrbit.tsx")),
    services: compile(read("app/entreprises/[slug]/InrSearchServicesOrbit.tsx")),
    faq: compile(read("app/entreprises/[slug]/InrSearchFaqOrbit.tsx")),
    contact: compile(read("app/entreprises/[slug]/InrSearchContactOrbit.tsx")),
    social: compile(read("app/entreprises/[slug]/InrSearchSocialOrbit.tsx")),
    news: compile(read("app/entreprises/[slug]/InrSearchNewsShowcase.tsx")),
    "./InrSearchLogo": compile(read("app/entreprises/[slug]/InrSearchLogo.tsx")),
    "./InrSearchLeadForm": compile("exports.default=()=>null;"),
    "./inrSearchContactEvents": compile(read("app/entreprises/[slug]/inrSearchContactEvents.ts")),
    "@/lib/inrBadgeQr": compile(read("lib/inrBadgeQr.ts")),
  };
  const requests: string[] = [];
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><main id="root" class="page" data-inrsearch-page></main></body></html>');
  await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;background:#050b2b;font-family:Arial,sans-serif}button{font:inherit}${read("app/entreprises/[slug]/inrSearchPublic.module.css").replace(/:global\(([^)]+)\)/g, "$1")}` });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},messages=${read("messages/en-GB/public.json")},strengths=${JSON.stringify(longStrengths)},loaded={},process={env:{NODE_ENV:'production'}};
    function require(name){
      if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name==='next-intl')return{useTranslations:()=> (key,values={})=>Object.entries(values).reduce((text,[key,value])=>text.replaceAll('{'+key+'}',String(value)),messages[key]||key)};
      if(name==='next/image')return{__esModule:true,default:props=>require('react').createElement('img',{...props,src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="lightblue"/></svg>'})};
      if(loaded[name])return loaded[name].exports;
      if(!sources[name])throw Error('Unexpected public scene fixture dependency '+name);
      const module=loaded[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.showScene=scene=>{
      const component=require(scene).default,companyName='Christophe Auteur',description='Une présentation complète de la prestation, de ses objectifs et des possibilités adaptées à chaque demande. '.repeat(24);
      const props={identity:{},zone:{companyName,city:'Montpellier',profession:'Écrivain et auteur de récits personnels et relationnels',zones:['Montpellier','Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson']},
        strengths:{companyName,strengths,inrBadgeUrl:'',inrBadgeQrUrl:''},services:{companyName,services:strengths.map(name=>({name,description})),audiences:[]},
        faq:{companyName,items:[{question:strengths[1]+' ?',answer:description},{question:'Comment prendre contact ?',answer:'Présentez votre besoin.'}],contactHref:'#contact'},
        contact:{slug:'isolated-test',companyName:('Christophe Auteur et accompagnement littéraire des lecteurs dans les échanges personnels et professionnels ').repeat(2),logoUrl:'',profession:strengths[1],city:'Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson',phone:'',phoneHref:'',email:'',emailHref:'',addressLine:'',websiteUrl:'',directionsUrl:''},
        social:{companyName:('Christophe Auteur et accompagnement littéraire des lecteurs dans les échanges personnels et professionnels ').repeat(2),profession:strengths[1],city:'Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson',logoUrl:'',links:[{key:'facebook',label:'Facebook',url:'https://example.com/facebook'},{key:'instagram',label:'Instagram',url:'https://example.com/instagram'}]},
        news:{companyName,publications:[{id:'one',title:strengths[1]+' dans la région de Montpellier et pour les lecteurs de toute la France',content:description,createdAt:'2026-11-04T10:00:00Z',imageUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="lightblue"/></svg>',videoUrl:null}]}}[scene];
      const section={identity:'presentationOrbit',zone:'zoneOrbitSection',strengths:'strengthOrbitSection',services:'servicesSection',faq:'faqOrbitSection',contact:'contactOrbit',social:'socialOrbitSection',news:'newsSection'}[scene];
      root.render(React.createElement('section',{className:'orbitPanel '+section,'data-fixture-scene':scene},React.createElement(component,props)));
    };window.showScene('identity');
  ` });
  page.setDefaultTimeout(3_000);
  return requests;
}

type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const bounds = (element: Element): Bounds => { const r = element.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };

test("long public content stays contained and usable in eight scenes at five screen widths", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1366, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const requests = await setup(page);
      await page.locator(".presentationMediaCaption").waitFor();
      const identity = await page.evaluate(() => {
        const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top:r.top,bottom:r.bottom,left:r.left,right:r.right }; };
        const text = document.querySelector<HTMLElement>('.presentationSatellite[data-kind="strengths"] strong')!;
        return { logo:rect(".presentationMediaFallback img"),caption:rect(".presentationMediaCaption"),orb:rect(".presentationMediaOrb"),factHeight:document.querySelector('.presentationSatellite[data-kind="strengths"]')!.getBoundingClientRect().height,
          scrollable:text.scrollHeight>text.clientHeight,focusable:text.tabIndex===0,title:text.title };
      });
      assert.ok(identity.logo.bottom <= identity.caption.top + 3, `${width}: the company caption never covers the logo`);
      assert.ok(identity.caption.bottom <= identity.orb.bottom + 1 && identity.caption.left >= identity.orb.left - 1 && identity.caption.right <= identity.orb.right + 1, `${width}: the caption stays inside the brand orb`);
      assert.ok(identity.factHeight <= 200, `${width}: a long strength does not create a giant identity card`);
      assert.ok(identity.scrollable && identity.focusable && identity.title.includes(longStrengths[0]), `${width}: the complete fact remains available through keyboard scrolling and its title`);
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-identity-${width}.png` });

      await page.evaluate("window.showScene('zone')");
      await page.locator(".zoneOrbitCore").waitFor();
      const city = await page.locator(".zoneOrbitCore > strong").evaluate(element => ({ width:element.clientWidth,scroll:element.scrollWidth,whiteSpace:getComputedStyle(element).whiteSpace,title:element.getAttribute("title") }));
      assert.equal(city.title, "Montpellier");
      assert.equal(city.whiteSpace, "nowrap", `${width}: the city is not split in the middle of a word`);
      assert.ok(city.scroll <= city.width + 1, `${width}: Montpellier fits the center label`);
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-zone-${width}.png` });
      await page.locator(".zoneOrbitNavigator button").last().click();
      assert.equal(await page.locator(".zoneOrbitDetail > strong").textContent(), "Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson");

      await page.evaluate("window.showScene('strengths')");
      await page.locator(".strengthNewtonScene").waitFor();
      const scene = await page.locator(".strengthNewtonScene").evaluate(bounds);
      const detail = await page.locator(".strengthNewtonDetail").evaluate(bounds);
      assert.ok(detail.left >= scene.left - 1 && detail.right <= scene.right + 1 && detail.bottom <= scene.bottom + 1, `${width}: the selected trust card stays in the scene`);
      assert.ok(detail.height <= 240, `${width}: the selected trust card scrolls instead of growing`);
      assert.equal(await page.locator(".strengthNewtonDetail").getAttribute("tabindex"), "0");
      if (width > 900) {
        const list = await page.locator(".strengthDesktopList").evaluate(bounds);
        assert.ok(list.right <= detail.left + 1, `${width}: the numbered list and detail occupy separate columns`);
        assert.ok(list.bottom <= scene.bottom + 1, `${width}: the numbered list stays in its scroll area`);
        await page.locator(".strengthDesktopList button").last().click();
      } else {
        for (const sphere of await page.locator(".strengthNewtonSphere").all()) {
          const ball = await sphere.evaluate(bounds);
          assert.ok(ball.bottom <= detail.top + 1, `${width}: numbered balls do not overlap the selected trust card`);
        }
        assert.equal(await page.locator(".strengthNewtonBall").last().getAttribute("aria-label"), longStrengths.at(-1));
        await page.locator(".strengthNewtonBall").last().click();
      }
      assert.equal(await page.locator(".strengthNewtonDetail > strong").textContent(), longStrengths.at(-1));
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-trust-${width}.png` });

      for (const scene of ["services", "faq"]) {
        await page.evaluate(scene => (window as unknown as { showScene: (scene: string) => void }).showScene(scene), scene);
        const card = page.locator(scene === "services" ? ".servicesOrbitFocus" : '.faqCarouselCard[data-position="active"]');
        await card.waitFor();
        assert.equal(await card.getAttribute("tabindex"), "0", `${width}: ${scene} text is keyboard-scrollable`);
        assert.equal(await card.evaluate(element => getComputedStyle(element).overflowY), "auto");
        const title = await card.locator("h3").textContent();
        await card.focus();
        await card.press("End");
        await page.waitForFunction(selector => document.querySelector(selector)!.scrollTop > 0,
          scene === "services" ? ".servicesOrbitFocus" : '.faqCarouselCard[data-position="active"]');
        assert.equal(await card.locator("h3").textContent(), title, "Reading a card does not change the selected item");
        const action = card.locator("a");
        await action.scrollIntoViewIfNeeded();
        const cardBounds = await card.evaluate(bounds), actionBounds = await action.evaluate(bounds);
        assert.ok(actionBounds.top >= cardBounds.top - 1 && actionBounds.bottom <= cardBounds.bottom + 1, `${width}: ${scene} contact action remains reachable`);
        if (scene === "services") {
          for (const label of await page.locator('.servicesOrbitCard[data-visible="true"] > strong').all()) {
            assert.ok(await label.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) * 3 + 1));
          }
          assert.equal(await page.locator('.servicesOrbitCard').first().getAttribute("title"), longStrengths[0]);
        }
        if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-${scene}-${width}.png` });
      }

      await page.evaluate("window.showScene('contact')");
      await page.locator(".contactCore").waitFor();
      const core = await page.locator(".contactCore").evaluate(bounds);
      assert.ok(Math.abs(core.width - core.height) <= 1, `${width}: the contact core stays circular with a long name`);
      for (const child of await page.locator(".contactCore > small,.contactCore > strong,.contactCore > em,.contactCore > button,.contactCore > .contactCoreFallback").all()) {
        const rectangle = await child.evaluate(bounds);
        assert.ok(rectangle.left >= core.left - 1 && rectangle.right <= core.right + 1 && rectangle.top >= core.top - 1 && rectangle.bottom <= core.bottom + 1, `${width}: contact labels and action stay in their circle`);
      }
      assert.ok((await page.locator(".contactCore > strong").getAttribute("title"))!.length > 126, "The complete long company name remains available");
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-contact-${width}.png` });

      await page.evaluate("window.showScene('social')");
      await page.locator(".socialOrbitCore").waitFor();
      const socialCore = await page.locator(".socialOrbitCore").evaluate(bounds);
      assert.ok(Math.abs(socialCore.width - socialCore.height) <= 1, `${width}: the social core stays circular with a long name and profession`);
      for (const child of await page.locator(".socialOrbitCore > small,.socialOrbitCore > strong,.socialOrbitCore > em,.socialOrbitCore > .socialOrbitFallback").all()) {
        const rectangle = await child.evaluate(bounds);
        assert.ok(rectangle.left >= socialCore.left - 1 && rectangle.right <= socialCore.right + 1 && rectangle.top >= socialCore.top - 1 && rectangle.bottom <= socialCore.bottom + 1, `${width}: social labels and logo stay in their circle`);
      }
      assert.ok((await page.locator(".socialOrbitCore > strong").getAttribute("title"))!.length > 126);
      await page.locator('.socialOrbitNode[data-network="instagram"]').focus();
      assert.equal(await page.locator(".socialOrbitDetail > strong").textContent(), "Instagram", "Keyboard focus still selects the network details");
      const socialAction = page.locator(".socialOrbitDetail > a");
      await socialAction.scrollIntoViewIfNeeded();
      const socialDetail = await page.locator(".socialOrbitDetail").evaluate(bounds), socialActionBounds = await socialAction.evaluate(bounds);
      assert.ok(socialActionBounds.top >= socialDetail.top - 1 && socialActionBounds.bottom <= socialDetail.bottom + 1, `${width}: the network action remains reachable`);
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-social-${width}.png` });

      await page.evaluate("window.showScene('news')");
      const newsContent = page.locator(".newsOrbitFocusContent");
      await newsContent.waitFor();
      assert.equal(await newsContent.getAttribute("tabindex"), "0", "The news summary can be scrolled with the keyboard");
      const newsTitle = await newsContent.locator("strong").textContent();
      const newsStart = await newsContent.evaluate(bounds), newsTitleStart = await newsContent.locator("strong").evaluate(bounds);
      assert.ok(newsTitleStart.top >= newsStart.top - 1, `${width}: a long headline starts inside its scroll window`);
      await newsContent.focus();
      await newsContent.press("End");
      await newsContent.locator(".newsOrbitRead").scrollIntoViewIfNeeded();
      const newsEnd = await newsContent.evaluate(bounds), newsAction = await newsContent.locator(".newsOrbitRead").evaluate(bounds);
      assert.ok(newsAction.top >= newsEnd.top - 1 && newsAction.bottom <= newsEnd.bottom + 1, `${width}: the news reading action remains reachable`);
      assert.equal(await newsContent.locator("strong").textContent(), newsTitle, "Reading a long headline does not switch the selected publication");
      if (process.env.INRCY_SCENE_PROOF) await page.screenshot({ path: `${process.env.INRCY_SCENE_PROOF}-news-${width}.png` });
      await newsContent.locator(".newsOrbitRead").click();
      await page.locator("#news-orbit-modal").waitFor();
      assert.equal(await page.locator("#news-orbit-modal-title").textContent(), newsTitle, "The complete headline opens in the news reader");
      await page.waitForFunction(() => document.activeElement?.classList.contains("newsOrbitModalClose"));
      await page.keyboard.press("Escape");
      await page.locator("#news-orbit-modal").waitFor({ state: "hidden" });
      await newsContent.press("Enter");
      await page.locator("#news-orbit-modal").waitFor();
      assert.equal(await page.locator("#news-orbit-modal-title").textContent(), newsTitle, "The focused news summary still opens with Enter");
      await page.waitForFunction(() => document.activeElement?.classList.contains("newsOrbitModalClose"));
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, [], `${width}: no render or interaction error`);
      assert.deepEqual(requests, [], "The fixture never contacts a real account or external service");
      await page.close();
    }
  } finally { await browser.close(); }
});
