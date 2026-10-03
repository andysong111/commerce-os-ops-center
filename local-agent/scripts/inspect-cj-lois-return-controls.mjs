import {
  listChromeTargets,
  withBrowserCdpTarget,
} from "../src/chrome-cdp.mjs";
import { loadConfig } from "../src/config.mjs";

function inspectCjControls() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const matches = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    matchCount: matches.length,
    apps: matches.map((instance) => {
      const controls = instance.getContainer().getAllRecursiveChildren();
      const summarizeListeners = (control) => Object.fromEntries(Object.entries(control?._eventListenerList || {})
        .map(([name, listeners]) => [name, (listeners || []).map((listener) => ({
          type: typeof listener,
          source: typeof listener === "function" ? String(listener).slice(0, 1200) : "",
        }))]));
      const titleChildren = instance.lookup("title")?.getAllRecursiveChildren?.() || [];
      return {
        appId: instance.app?.id || "",
        targetDetails: {
          originalInvoiceListeners: summarizeListeners(instance.lookup("strOgnWblNo")),
          reservationListeners: summarizeListeners(instance.lookup("rdbRsvt")),
          reservationItems: instance.lookup("rdbRsvt")?.getItems?.().map((item) => ({
            label: item.label,
            value: item.value,
          })) || [],
          titleChildren: titleChildren.map((control) => ({
            id: control.id || "",
            type: control.constructor?.name || "",
            embeddedAppId: control.getEmbeddedAppInstance?.()?.app?.id || "",
            listenerNames: Object.keys(control?._eventListenerList || {}),
            embeddedListenerNames: Object.keys(control.getEmbeddedAppInstance?.()?._eventListenerList || {}),
          })),
        },
        controls: controls.map((control) => ({
          id: control.id || "",
          type: control.constructor?.name || "",
          valueLength: String(control.value || "").length,
          value: typeof control.click === "function"
            ? String(control.value || control.text || "").replace(/\s+/g, " ").trim().slice(0, 80)
            : "",
          enabled: control.enabled !== false,
          visible: control.visible !== false,
          clickable: typeof control.click === "function",
          parentId: control.getParent?.()?.id || "",
        })).filter((control) => control.id),
        dataControls: instance.getAllDataControls().map((data) => ({
          id: data.id || "",
          type: data.constructor?.name || "",
          columns: data.getColumnNames?.() || [],
          rowCount: Number.isFinite(data.getRowCount?.()) ? data.getRowCount() : null,
        })),
      };
    }),
  };
}

const config = loadConfig();
const listing = await listChromeTargets(config);
const targets = listing.targets.filter((target) => target.type === "page"
  && config.cjLoisOrigins.some((origin) => target.url.startsWith(origin)));
if (targets.length !== 1) {
  throw Object.assign(new Error("Exactly one CJ LOIS tab is required."), {
    code: "CJ_LOIS_TARGET_COUNT_INVALID",
    matchCount: targets.length,
  });
}
const expression = `(${inspectCjControls.toString()})()`;
const result = await withBrowserCdpTarget(config, targets[0], async (session) => {
  const evaluated = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, 15_000);
  return evaluated.result?.value;
}, { timeoutMs: 15_000 });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
