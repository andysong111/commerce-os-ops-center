import { loadConfig } from "../src/config.mjs";
import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  withCdpTarget,
} from "../src/chrome-cdp.mjs";

const config = loadConfig();
const listing = await listChromeTargets(config);
const target = listing.targets.find((item) => item.type === "page"
  && config.shoplingOrigins.some((origin) => item.url.startsWith(origin)));
if (!target) throw Object.assign(new Error("Shopling tab was not found."), { code: "SHOPLING_TARGET_MISSING" });

const expression = `(() => {
  const text = String(document.body?.innerText || "");
  return {
    readyState: document.readyState,
    path: location.pathname,
    title: document.title,
    bodyLength: text.length,
    expectedAccountMarker: text.includes("[andy801]"),
    loginFormPresent: Boolean(document.querySelector('input[type="password"]')),
    b7ControlsPresent: Boolean(document.querySelector('select[name="ordstat_tp"]'))
      && Boolean(document.querySelector('select[name="status"]')),
  };
})()`;
const result = await withCdpTarget(target, (session) => (
  evaluateCdpExpressionAcrossFrames(session, expression, { timeoutMs: 10_000 })
), { timeoutMs: 10_000 });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
