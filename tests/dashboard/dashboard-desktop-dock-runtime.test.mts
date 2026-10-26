import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as editionPolicy from "../../lib/dashboardEdition.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const dashboard = JSON.parse(read("messages/fr-FR/dashboard.json"));
const messages = { dashboard, shell: JSON.parse(read("messages/fr-FR/shell.json")) };
const compiled = new Map(["DashboardTopbar", "DashboardGeneratorHub", "DashboardGeneratorOrb"].map((name) => [name, ts.transpileModule(read(`app/dashboard/_components/${name}.tsx`), {
  fileName: `${name}.tsx`,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText]));

type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
type Effect = () => void | (() => void);
const NotificationMenu = (_props: Props) => null;
const EstablishmentMenu = (_props: Props) => null;
const LanguageSelector = (_props: Props) => null;

function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return isValidElement<Props>(tree) ? [tree, ...elements(tree.props.children as ReactNode)] : [];
}
function content(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return isValidElement<Props>(tree) ? content(tree.props.children as ReactNode) : "";
}
function find(tree: ReactNode, predicate: (element: Element) => boolean): Element {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected dashboard control is missing");
  return result;
}
function hasClass(node: Element, name: string): boolean {
  return String(node.props.className ?? "").split(/\s+/u).includes(name);
}
function invoke(node: Element, callback: string) {
  assert.equal(typeof node.props[callback], "function", `Missing ${callback} callback`);
  (node.props[callback] as () => void)();
}
function click(node: Element) {
  assert.equal(node.type, "button");
  assert.notEqual(node.props.disabled, true, "Disabled controls must not be activated");
  invoke(node, "onClick");
}

/** Run the real JSX and callback wiring with isolated external hooks. Portals
 * retain their child React elements and host identity; no browser, account or
 * network request is needed to exercise the header's permission boundaries. */
function harness(edition: editionPolicy.DashboardEdition = "premium") {
  const effects: Effect[] = [];
  const portals: { child: ReactNode; host: unknown }[] = [];
  const calls = { routes: [] as string[], panels: [] as string[], warmups: [] as string[], userMenu: [] as boolean[], notificationMenu: [] as boolean[], enabled: [] as boolean[], logout: 0, gps: 0, assistant: 0 };
  const mockRequire = (specifier: string): unknown => {
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier === "next/image") return { __esModule: true, default: (props: Props) => createElement("img", props) };
    if (specifier === "react") return { useEffect: (effect: Effect) => { effects.push(effect); } };
    if (specifier === "react-dom") return { createPortal: (child: ReactNode, host: unknown) => {
      portals.push({ child, host });
      return createElement("test-portal", { host }, child);
    } };
    if (specifier === "next-intl") return { useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      const result = `${namespace}.${key}`.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Props)[segment] : undefined, messages);
      assert.equal(typeof result, "string", `Missing translation ${namespace}.${key}`);
      return (result as string).replace(/\{([^{}]+)\}/gu, (token, name: string) => values && name in values ? String(values[name]) : token);
    } };
    if (specifier === "next/navigation") return { useRouter: () => ({ prefetch: (route: string) => { calls.warmups.push(route); } }) };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (specifier === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ ...dashboard, locale: "fr-FR" }) };
    if (specifier === "../_hooks/useInrAgentPendingCount") return { useInrAgentPendingCount: (enabled: boolean) => { calls.enabled.push(enabled); return enabled ? 2 : 0; } };
    if (specifier === "@/lib/dashboardEdition") return editionPolicy;
    if (specifier === "./DashboardEditionProvider") return { useDashboardEdition: () => edition };
    if (specifier === "./DashboardAssistantProvider") return { useDashboardAssistant: () => ({ toggleAssistant: () => { calls.assistant += 1; }, assistantOpen: false, assistantLabel: "Ouvrir iNr’Assistant", assistantUnread: false }) };
    if (specifier === "./DashboardAssistantTrigger") return { DashboardAssistantBadge: () => null };
    if (specifier === "./NotificationMenu") return { __esModule: true, default: NotificationMenu };
    if (specifier === "./DashboardNavigationIcon") return { __esModule: true, default: (props: Props) => createElement("svg", { "data-dashboard-navigation-icon": props.kind, "aria-hidden": "true" }) };
    if (specifier === "./DashboardGeneratorOrb") return { __esModule: true, default: component("DashboardGeneratorOrb") };
    if (specifier === "./EstablishmentMenu") return { __esModule: true, default: EstablishmentMenu };
    if (specifier === "./LanguageSelector") return { __esModule: true, default: LanguageSelector };
    assert.fail(`Unexpected dashboard dependency: ${specifier}`);
  };
  function component(name: string) {
    const record = { exports: {} as { default: (props: Props) => ReactNode } };
    assert.ok(compiled.has(name));
    new Function("module", "exports", "require", compiled.get(name)!)(record, record.exports, mockRequire);
    return record.exports.default;
  }
  const props = {
    desktopNotificationMenuRef: { current: null }, mobileNotificationMenuRef: { current: null }, userMenuRef: { current: null },
    notificationMenuOpen: true, setNotificationMenuOpen: (open: boolean) => { calls.notificationMenu.push(open); },
    unreadNotificationsCount: 12, refreshNotifications: () => {}, notificationsLoading: false,
    notifications: [{ id: "notification-1" }], notificationsError: null,
    markAllNotificationsRead: () => {}, markNotificationRead: (_id: string) => {}, deleteNotification: (_id: string) => {},
    onNavigateCta: (route: string) => { calls.routes.push(route); }, openPanel: (panel: string) => { calls.panels.push(panel); },
    inrAgentEnabled: true, showInrAgent: false, userEmail: "qa@example.invalid", userFirstLetter: "Q", profileIncomplete: false, activityIncomplete: false,
    userMenuOpen: false, setUserMenuOpen: (open: boolean) => { calls.userMenu.push(open); },
    onOpenHelp: () => { calls.gps += 1; }, handleLogout: () => { calls.logout += 1; },
  };
  return { calls, portals, props, render: (name: string, overrides: Props = {}) => component(name)({ ...props, ...overrides }), flushEffects: () => effects.forEach((effect) => effect()) };
}

for (const edition of ["basic", "standard", "premium", "founder"] as const) {
  for (const hosted of [false, true]) {
    for (const isAdmin of [false, true]) {
      test(`desktop header preserves actions and permissions: ${edition}, ${hosted ? "portals" : "header fallback"}, ${isAdmin ? "Admin" : "professional"}`, () => {
        const view = harness(edition);
        const leftHost = hosted ? { slot: "left" } : null;
        const rightHost = hosted ? { slot: "right" } : null;
        const tree = view.render("DashboardTopbar", { desktopLeftHost: leftHost, desktopRightHost: rightHost, isAdmin });
        assert.equal(view.calls.logout, 0, "Rendering must never initiate logout");
        assert.deepEqual(view.calls.routes, []);
        assert.deepEqual(view.calls.panels, []);
        assert.deepEqual(view.calls.enabled, [false], "Hidden agent must not poll pending actions");
        assert.deepEqual(view.portals.map(({ host }) => host), hosted ? [leftHost, rightHost] : []);
        const left = find(tree, (node) => node.props["data-dashboard-desktop-dock"] === "left");
        const right = find(tree, (node) => node.props["data-dashboard-desktop-dock"] === "right");
        if (hosted) {
          assert.equal(view.portals[0].child, left);
          assert.equal(view.portals[1].child, right);
        }
        const leftActions = elements(left).filter(node => node.type === "button");
        assert.deepEqual(leftActions.map(node => node.props["data-testid"] === "inr-assist-preview" ? "assist" : "help"), hosted ? ["assist"] : ["assist", "help"]);
        const assist = find(left, node => node.props["data-testid"] === "inr-assist-preview");
        assert.equal(assist.props["aria-disabled"], undefined);
        assert.equal(assist.props["aria-haspopup"], "dialog");
        assert.equal(view.calls.assistant, 0, "Rendering must never send a chat request");
        click(assist);
        assert.equal(view.calls.assistant, 1, "The pink assistant icon opens the assistant panel");
        const rightActions = elements(right).flatMap(node => node.type === NotificationMenu ? ["notifications"] : node.type !== "button" ? []
          : node.props["data-dashboard-panel"] === "boutique" ? ["shop"] : node.props["data-dashboard-action"] === "cash" ? ["cash"] : ["contact"]);
        assert.deepEqual(rightActions, edition === "founder" ? ["notifications", "shop", "contact", "cash"] : ["notifications", "shop", "contact"]);
        assert.equal(elements(left).filter(node => node.type === NotificationMenu).length, 0);
        const company = find(tree, (node) => hasClass(node, "establishmentSlot"));
        const desktopAdmin = elements(company).filter((node) => node.type === "button" && node.props["aria-label"] === dashboard.topbar.adminTitle);
        assert.equal(desktopAdmin.length, isAdmin ? 1 : 0);
        assert.equal(elements(left).filter((node) => node.props["aria-label"] === dashboard.topbar.adminTitle).length, 0);
        if (isAdmin) { click(desktopAdmin[0]); assert.equal(view.calls.routes.at(-1), "/dashboard/admin"); }

        const account = find(tree, (node) => node.props["data-dashboard-action"] === "account");
        assert.equal(account.props["aria-label"], dashboard.topbar.myAccount);
        assert.equal(account.props.title, dashboard.topbar.myAccount);
        click(account);
        assert.equal(view.calls.panels.at(-1), "compte");
        click(find(right, (node) => node.type === "button" && node.props["aria-label"] === dashboard.topbar.contact));
        assert.equal(view.calls.panels.at(-1), "contact");
        const shop = find(right, (node) => node.props["data-dashboard-panel"] === "boutique");
        assert.equal(shop.props["aria-label"], dashboard.userMenu.shop);
        assert.equal(shop.props.title, dashboard.userMenu.shop);
        click(shop);
        assert.equal(view.calls.panels.at(-1), "boutique");
        assert.equal(elements(right).filter((node) => node.type === "button").length, edition === "founder" ? 3 : 2);
        for (const label of [dashboard.userMenu.inertia, dashboard.userMenu.referral, dashboard.topbar.menu]) {
          if (label) assert.equal(elements(tree).filter((node) => node.type === "button" && node.props["aria-label"] === label).length, 0);
        }
        const cash = elements(right).filter((node) => node.props["data-dashboard-action"] === "cash");
        assert.equal(cash.length, edition === "founder" ? 1 : 0, "Accounting remains Founder-only");
        if (cash.length) { click(cash[0]); assert.equal(view.calls.routes.at(-1), "/dashboard?action=cash"); }
        const fallbackHelp = elements(left).filter((node) => node.type === "button" && node.props["aria-label"] === dashboard.helpCenter.aria);
        assert.equal(fallbackHelp.length, hosted ? 0 : 1, "The central hub owns the single desktop help action once its hosts mount");
        if (!hosted) click(fallbackHelp[0]);
        assert.equal(view.calls.gps, hosted ? 0 : 1);
        const mobileHelp = find(tree, (node) => node.type === "button" && hasClass(node, "mobileHeaderGpsBtn"));
        assert.equal(mobileHelp.props["aria-label"], dashboard.helpCenter.aria);
        assert.equal(mobileHelp.props["aria-haspopup"], "dialog");
        click(mobileHelp);
        assert.equal(view.calls.gps, hosted ? 1 : 2);

        const notices = elements(tree).filter((node) => node.type === NotificationMenu);
        assert.equal(notices.length, 2, "Desktop and mobile retain their real notification instances");
        for (const notice of notices) {
          for (const key of ["notificationMenuOpen", "setNotificationMenuOpen", "unreadNotificationsCount", "refreshNotifications", "notificationsLoading", "notifications", "notificationsError", "markAllNotificationsRead", "markNotificationRead", "deleteNotification"] as const) {
            assert.equal(notice.props[key], view.props[key], key);
          }
          assert.equal(notice.props.onNavigate, view.props.onNavigateCta);
          invoke(notice, "openPanel");
          assert.equal(view.calls.panels.at(-1), "notifications");
        }
        assert.notEqual(notices[0].props.mobile, true);
        const notificationIcon = notices[0].props.icon;
        assert.ok(isValidElement<Props>(notificationIcon), "The desktop notification keeps its decorative icon override");
        assert.equal(notificationIcon.props.kind, "bell");
        assert.equal(notices[1].props.icon, undefined, "Mobile retains the existing notification icon fallback");
        assert.equal(notices[1].props.mobile, true);
        const noticeParents = elements(tree).filter((node) => node.props.children && elements(node.props.children as ReactNode).includes(notices[0]) && node.props.ref === view.props.desktopNotificationMenuRef);
        assert.equal(noticeParents.length, 1, "The desktop notification ref moves with its menu");
        const languages = elements(tree).filter((node) => node.type === LanguageSelector);
        assert.equal(languages.length, 2);
        invoke(languages[0], "onOpen");
        assert.equal(view.calls.userMenu.at(-1), false);
        assert.equal(view.calls.notificationMenu.at(-1), false);
        assert.equal(languages[1].props.mobile, true);
        const companies = elements(tree).filter((node) => node.type === EstablishmentMenu);
        assert.equal(companies.length, 2);
        assert.equal(companies[1].props.mobile, true);
        assert.equal(view.calls.logout, 0, "All other header controls must preserve the session");
        click(find(tree, (node) => node.props["data-dashboard-action"] === "logout"));
        assert.equal(view.calls.logout, 1);
        assert.equal(view.calls.userMenu.at(-1), false);
      });
    }
  }
}

for (const enabled of [false, true]) {
  test(`the optional legacy agent preserves its ${enabled ? "enabled" : "disabled"} guard`, () => {
    const view = harness();
    const tree = view.render("DashboardTopbar", { showInrAgent: true, inrAgentEnabled: enabled });
    const agent = find(tree, (node) => node.type === "button" && hasClass(node, "agentTopbarBtn"));
    assert.equal(agent.props.disabled, !enabled);
    assert.equal(agent.props["aria-disabled"], !enabled);
    assert.deepEqual(view.calls.enabled, [enabled]);
    view.flushEffects();
    invoke(agent, "onPointerEnter");
    invoke(agent, "onFocus");
    // Exercise the callback guard as well as the disabled DOM control.
    invoke(agent, "onClick");
    assert.deepEqual(view.calls.routes, enabled ? ["/dashboard/agent"] : []);
    assert.equal(view.calls.warmups.length, enabled ? 4 : 0);
    assert.equal(view.calls.logout, 0);
  });
}

for (const active of [false, true]) {
  for (const loading of [false, true]) {
    test(`the generator keeps its real accessible state and callback guards: ${active ? "active" : "waiting"}, ${loading ? "loading" : "ready"}`, () => {
      const view = harness();
      const commands: string[] = [];
      const hostCallbacks = { left: () => {}, right: () => {} };
      const tree = view.render("DashboardGeneratorHub", {
        onDesktopLeftHost: hostCallbacks.left, onDesktopRightHost: hostCallbacks.right,
        onOpenGeneratorHelp: () => commands.push("help"), onOpenGeneratorSettings: () => commands.push("settings"), onRefreshGenerator: () => commands.push("refresh"),
        generatorIsActive: active, kpisLoading: loading,
        inertiaSnapshot: { multiplier: 6.5, connectedCount: 9, totalChannels: 13 },
      });
      const hub = find(tree, (node) => node.props["data-testid"] === "dashboard-generator-hub");
      const status = active ? dashboard.hero.active : dashboard.hero.waiting;
      assert.equal(hub.props["data-active"], active);
      assert.equal(hub.props["aria-label"], `${dashboard.hero.settingsAria} · ${status}`);
      assert.ok(String(hub.props.title).includes(`${dashboard.hero.settingsTitle} · ${status}`));
      assert.equal(hub.props["aria-haspopup"], "dialog");
      assert.equal(content(hub), "", "The generator orb must not contain visible title or status text");
      const orb = find(hub, (node) => typeof node.type === "function" && "isActive" in node.props);
      assert.equal(orb.props.isActive, active, "The shared drawing receives the same live state as its accessible action");
      const drawing = (orb.type as (props: Props) => ReactNode)(orb.props);
      const visual = find(drawing, (node) => node.props["data-generator-orb"] === "true");
      assert.equal(visual.props["data-active"], String(active));
      assert.equal(visual.props["aria-hidden"], "true", "The shared drawing and its status dot are decorative");
      assert.equal(content(drawing), "", "Extracting the drawing must not introduce redundant visible status text");
      assert.equal(find(visual, (node) => hasClass(node, "status")).type, "span");
      assert.equal(find(tree, (node) => hasClass(node, "desktopToolsLeft")).props.ref, hostCallbacks.left);
      assert.equal(find(tree, (node) => hasClass(node, "desktopToolsRight")).props.ref, hostCallbacks.right);
      const leftControls = find(tree, node => hasClass(node, "generatorLeftControls"));
      const groupedCommands = elements(leftControls).filter(node => node.props.ref === hostCallbacks.left || node.type === "button");
      assert.deepEqual(groupedCommands.map(node => node.props.ref === hostCallbacks.left ? "assist-host" : node.props["aria-label"] === dashboard.helpCenter.aria ? "help" : "refresh"), ["assist-host", "help", "refresh"]);
      assert.ok(!elements(leftControls).includes(hub), "The generator remains outside the left command group");
      const row = find(tree, node => hasClass(node, "generatorActions"));
      const rowChildren = (Array.isArray(row.props.children) ? row.props.children : [row.props.children]).filter(isValidElement);
      assert.equal(rowChildren.length, 3);
      assert.equal(rowChildren[0], leftControls);
      assert.equal(rowChildren[1], hub);
      assert.equal(rowChildren[2], find(tree, node => hasClass(node, "desktopToolsRight")));
      click(find(tree, (node) => node.type === "button" && node.props["aria-label"] === dashboard.helpCenter.aria));
      click(hub);
      const refresh = find(tree, (node) => node.type === "button" && node.props["aria-label"] === dashboard.hero.refreshAria);
      assert.equal(refresh.props.disabled, loading);
      assert.equal(refresh.props["aria-busy"], loading || undefined);
      if (!loading) click(refresh);
      assert.deepEqual(commands, loading ? ["help", "settings"] : ["help", "settings", "refresh"]);
      assert.deepEqual(view.calls.routes, []);
      assert.equal(view.calls.logout, 0);
    });
  }
}
