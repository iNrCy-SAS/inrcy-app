import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import ts from "typescript";

// The transpiled components expose different prop/event shapes at this test boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const bubbleLabels = JSON.parse(read("messages/fr-FR/dashboard.json")).channelBubble;
const shellLabels = JSON.parse(read("messages/fr-FR/shell.json"));
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const child = (props: Props) => React.createElement("div", {}, props.children);

/** Execute the real component and event closures without a browser or live services. */
export function channelRuntime(path: string, overrides: Props = {}) {
  const slots: unknown[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId: () => "test-channel",
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect() {},
  };
  const browser = { location: { href: "", search: "" } };
  const localRequire = (specifier: string): unknown => {
    if (specifier in overrides) return overrides[specifier];
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier.endsWith(".css")) return css;
    if (specifier === "next/image") return { __esModule: true, default: "img" };
    if (specifier === "next-intl") return { useTranslations: (scope: string) => (key: string) => (scope === "shell" ? shellLabels : bubbleLabels)[key] || key };
    if (specifier === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
    if (specifier.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: false }) };
    if (specifier.endsWith("DashboardAssistantScreenContext")) return { useInrAssistantScreen() {} };
    if (specifier.endsWith("useUnsavedExitGuard")) return { useUnsavedExitGuard() {} };
    if (specifier.endsWith("DashboardUnsavedNavigationProvider")) return { useDashboardUnsavedNavigation: () => ({ requestNavigation: async (fn: () => void) => { fn(); return true; } }) };
    return { __esModule: true, default: child, DashboardPremiumLockIcon: child };
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} as Record<string, (props: Props) => React.ReactElement<Props>> };
  new Function("module", "exports", "require", "window", "fetch", code)(loadedModule, loadedModule.exports, localRequire, browser, () => { throw Error("Unexpected live request"); });
  return { browser, render: (props: Props, name = "default") => { cursor = 0; return loadedModule.exports[name](props); } };
}

export function channelNodes(tree: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(channelNodes);
  return React.isValidElement<Props>(tree) ? [tree, ...channelNodes(tree.props.children)] : [];
}

export const channelItem = { key: "gmb", name: "Google Business", description: "Augmente les appels", logoSrc: "/icons/gmb.png", accent: "cyan", bubbleStatus: "connected", bubbleStatusText: "Connecté", onConfigure() {} };

export function workspaceConnection(props: Props, overrides: Props = {}) {
  const runtime = channelRuntime("app/dashboard/_components/DashboardChannelWorkspace.tsx", overrides);
  return channelNodes(runtime.render(props)).find(node => node.props.item?.connection)!.props.item.connection;
}
