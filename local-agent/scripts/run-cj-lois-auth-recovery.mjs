import { loadConfig } from "../src/config.mjs";
import {
  recoverCjLoisSession,
  runCjLoisAuthPreflight,
} from "../src/cj-lois-auth-recovery.mjs";

const execute = process.argv.includes("--execute");
const config = loadConfig();
const result = execute
  ? await recoverCjLoisSession(config)
  : await runCjLoisAuthPreflight(config);

const output = `${JSON.stringify({
  ...result,
  mode: execute ? "EXECUTE" : "PLAN_ONLY",
}, null, 2)}\n`;
process.stdout.write(output);
