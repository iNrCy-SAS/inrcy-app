import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createQaExecutionPlan, executeQaPlan, npmScriptArguments } from "./qa-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, ...options] = process.argv.slice(2);
try {
  if (options.some((option) => option !== "--plan")) throw new Error("Usage: npm run <qa-command> [-- --plan]");
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const plans = JSON.parse(readFileSync(path.join(root, "scripts/qa-plans.json"), "utf8"));
  const plan = createQaExecutionPlan(name, scripts, plans);
  if (options.includes("--plan")) {
    console.log(JSON.stringify({ name, scripts: plan }, null, 2));
  } else {
    npmScriptArguments(process.env.npm_execpath, plan[0]);
    console.log(`[qa] ${name}: ${plan.length} distinct npm suites/checks; lifecycle hooks preserved.`);
    process.exitCode = await executeQaPlan(plan, (script) => new Promise((resolve) => {
      console.log(`[qa] npm run ${script}`);
      const child = spawn(process.execPath, npmScriptArguments(process.env.npm_execpath, script), {
        cwd: root, env: process.env, stdio: "inherit", windowsHide: true,
      });
      child.once("error", (error) => { console.error(error.message); resolve(1); });
      child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
    }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
