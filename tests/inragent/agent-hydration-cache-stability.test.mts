import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeHook = readFileSync(
  new URL(
    "../../app/dashboard/agent/_hooks/useAgentRuntimeData.ts",
    import.meta.url,
  ),
  "utf8",
);

test("iNrAgent keeps the server and browser hydration initializer deterministic", () => {
  assert.doesNotMatch(
    runtimeHook,
    /useMemo\(\s*\(\)\s*=>\s*readCachedAgentViewSnapshot\(\)/,
  );
  assert.match(
    runtimeHook,
    /deterministicInitialSettings[\s\S]*useState<ConnectedChannelMap \| null>\(null\)/,
  );
  assert.match(runtimeHook, /useState<LoadState>\("loading"\)/);
});

test("iNrAgent restores its account cache only after hydration", () => {
  assert.match(
    runtimeHook,
    /useEffect\(\(\) => \{\s*const cachedSnapshot = readCachedAgentViewSnapshot\(\)/,
  );
  assert.match(runtimeHook, /cachedAgentSnapshotRef\.current = cachedSnapshot/);
  assert.match(runtimeHook, /setActionsLoadState\("ready"\)/);
});
