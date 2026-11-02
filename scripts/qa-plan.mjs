const finalChecks = ["typecheck", "lint", "build"];

/** Expand reviewed aggregators, keeping each npm suite once and global checks last. */
export function createQaExecutionPlan(name, scripts, plans) {
  if (!Object.hasOwn(plans, name)) throw new Error(`Unknown QA plan: ${name}`);
  const result = [];
  const seen = new Set();
  function visit(current, ancestors = []) {
    if (!/^[\w:-]+$/.test(current) || !Object.hasOwn(scripts, current)) {
      throw new Error(`Unknown npm script: ${current}`);
    }
    if (ancestors.includes(current)) throw new Error(`Cyclic QA plan: ${[...ancestors, current].join(" -> ")}`);
    if (Object.hasOwn(plans, current)) {
      const children = plans[current];
      if (!Array.isArray(children) || children.length === 0) throw new Error(`Empty QA plan: ${current}`);
      for (const child of children) visit(child, [...ancestors, current]);
      return;
    }
    if (!seen.has(current)) {
      seen.add(current);
      result.push(current);
    }
  }
  visit(name);
  return [...result.filter((script) => !finalChecks.includes(script)), ...finalChecks.filter((script) => seen.has(script))];
}

/** Sequential and fail-fast, including for injected local test executors. */
export async function executeQaPlan(plan, runScript) {
  for (const name of plan) {
    const code = await runScript(name);
    if (code !== 0) return code || 1;
  }
  return 0;
}

export function npmScriptArguments(npmCli, name) {
  if (!npmCli || !/^[\w:-]+$/.test(name)) throw new Error("Run this QA plan through npm run so npm lifecycle hooks remain enabled.");
  return [npmCli, "run", name];
}
