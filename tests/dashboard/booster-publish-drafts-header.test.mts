import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const eventsRoute = read("app/api/booster/events/route.ts");
const modalLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const draftMenu = read(
  "app/dashboard/booster/publier/components/PublishDraftHeaderMenu.tsx",
);
const draftMenuStyles = read(
  "app/dashboard/booster/publier/components/publishDraftHeaderMenu.module.css",
);
const workflowBaseModal = read(
  "app/dashboard/_components/WorkflowBaseModal.tsx",
);
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);

test("le menu du header ne liste que les brouillons Booster du compte actif", () => {
  assert.match(eventsRoute, /draftListRequested = url\.searchParams\.get\("view"\) === "drafts"/);
  assert.match(
    eventsRoute,
    /\.eq\("user_id", activeUserId\)[\s\S]{0,220}\.eq\("module", "booster"\)[\s\S]{0,120}\.eq\("type", "publish_draft"\)/,
  );
  assert.match(eventsRoute, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(draftMenu, /\/api\/booster\/events\?view=drafts&limit=20/);
});

test("le header de Publier ouvre un brouillon sans créer un second stockage", () => {
  assert.match(modalLayer, /<PublishDraftHeaderMenu/);
  assert.match(modalLayer, /params\.set\("action", "publish"\)/);
  assert.match(modalLayer, /params\.set\("draftId", nextDraftId\)/);
  assert.match(modalLayer, /router\.replace\(`\/dashboard\?\$\{params\.toString\(\)\}`/);
  assert.match(modalLayer, /publishHasUnsavedChanges[\s\S]{0,260}confirmInrcy/);
  assert.match(draftMenu, /aria-haspopup="menu"/);
  assert.match(draftMenu, /draft\.id === activeDraftId/);
});

test("le menu des brouillons flotte au-dessus de l'outil sans être rogné", () => {
  assert.match(draftMenu, /createPortal\(/);
  assert.match(draftMenu, /document\.body/);
  assert.match(draftMenu, /menuRef\.current\?\.contains\(target\)/);
  assert.match(
    draftMenuStyles,
    /\.menu\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1000;/,
  );
});

test("le titre Publier reste centré malgré les actions du header", () => {
  assert.match(
    workflowBaseModal,
    /"minmax\(0, 1fr\) auto minmax\(0, 1fr\)"/,
  );
});

test("les brouillons sont regroupés avec l'enregistrement après les outils du header", () => {
  const agentShortcutIndex = modalLayer.indexOf("data-inr-agent-header-shortcut");
  const draftMenuIndex = modalLayer.indexOf("<PublishDraftHeaderMenu", agentShortcutIndex);
  const saveDraftIndex = modalLayer.indexOf(
    "publishSaveDraftRef.current?.()",
    draftMenuIndex,
  );

  assert.ok(agentShortcutIndex >= 0);
  assert.ok(draftMenuIndex > agentShortcutIndex);
  assert.ok(saveDraftIndex > draftMenuIndex);
  assert.match(
    draftMenuStyles,
    /@media \(max-width: 768px\)[\s\S]*?\.root \.trigger\s*\{[\s\S]*?width:\s*34px;[\s\S]*?\.triggerLabel,[\s\S]*?display:\s*none;/,
  );
});

test("la barre de génération est révélée automatiquement après le clic IA", () => {
  assert.match(publishModal, /const generationProgressRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(
    publishModal,
    /if \(!generating\) return;[\s\S]{0,260}generationProgressRef\.current\?\.scrollIntoView\([\s\S]{0,120}block: "center"/,
  );
  assert.match(publishModal, /generationProgressRef=\{generationProgressRef\}/);
  assert.match(intentPanel, /ref=\{generationProgressRef\}/);
});
