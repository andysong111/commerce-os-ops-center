import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createMobileWorkWorker, createWindowsWorkAdapter } from "./worker.mjs";
import { createOndolPassAdapter } from "./ondolpass.mjs";

const path = process.argv[2];
if (!path) throw new Error("Start the mobile worker with the path to its private configuration file.");
async function readStdin() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 8192) throw new Error("MOBILE_WORK_AGENT_CONFIG_TOO_LARGE");
  }
  return text;
}
const config = JSON.parse((path === "--stdin" ? await readStdin() : await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
const singleton = createServer((socket) => socket.destroy());
await new Promise((resolve, reject) => {
  singleton.once("error", reject);
  singleton.listen(43129, "127.0.0.1", resolve);
});

const pc = createWindowsWorkAdapter({ ondolpass: createOndolPassAdapter() });
const adapter = {
  async status() {
    const snapshot = await pc.status();
    return config.allowBusiness === true ? snapshot : { ...snapshot, actions: snapshot.actions.filter((id) => id === "connection-check") };
  },
  execute(command) {
    if (config.allowBusiness !== true && command.actionId !== "connection-check") return { status: "failed", code: "REJECTED_BY_PC" };
    return pc.execute(command);
  },
};
let lastError = "";
const worker = createMobileWorkWorker({
  ...config, adapter,
  onError(code) {
    if (code !== lastError) console.error("mobile-work-center", code);
    lastError = code;
  },
});

for (;;) {
  await worker.tick();
  await delay(worker.isActive() ? 6_000 : 30_000);
}
