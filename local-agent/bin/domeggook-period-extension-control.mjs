#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { createDomeggookPeriodExtensionControlServer } from "../src/domeggook-period-extension-control-server.mjs";

const config = loadConfig();
const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 43122;
const control = await createDomeggookPeriodExtensionControlServer(config, { port });
const listening = await control.listen();
console.log(JSON.stringify({ event: "domeggook_control_started", url: listening.origin }));

await new Promise((resolve) => {
  const stop = () => void control.close().finally(resolve);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});
