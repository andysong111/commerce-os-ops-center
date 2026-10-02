import { loadConfig } from "../src/config.mjs";
import { listChromeTargets, shoplingTargets, withCdpTarget } from "../src/chrome-cdp.mjs";

const LIST_PATH = "/qna/qnaList.phtml";
const config = loadConfig();
const listed = await listChromeTargets(config);
const listTargets = shoplingTargets(listed.targets, config.shoplingOrigins)
  .filter((target) => new URL(target.url).pathname === LIST_PATH);
if (listTargets.length !== 1) throw new Error(`SHOPLING_QNA_LIST_TARGET_COUNT_INVALID:${listTargets.length}`);

const qnaKey = await withCdpTarget(listTargets[0], async (session) => {
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const button = Array.from(document.querySelectorAll("[onclick]"))
        .find((element) => String(element.getAttribute("onclick") || "").includes("qna_popup"));
      const match = String(button?.getAttribute("onclick") || "").match(/[0-9]+/);
      if (!match || typeof qna_popup !== "function") throw new Error("SHOPLING_QNA_SAMPLE_MISSING");
      qna_popup(match[0]);
      return match[0];
    })()`,
    returnByValue: true,
    userGesture: true,
  }, 10_000);
  if (result.exceptionDetails) throw new Error("SHOPLING_QNA_POPUP_OPEN_FAILED");
  return String(result.result?.value || "");
}, { timeoutMs: 15_000 });

await new Promise((resolve) => setTimeout(resolve, 2_000));
const afterOpen = await listChromeTargets(config);
const popupTargets = shoplingTargets(afterOpen.targets, config.shoplingOrigins)
  .filter((target) => new URL(target.url).pathname !== LIST_PATH);
if (popupTargets.length !== 1) throw new Error(`SHOPLING_QNA_REPLY_TARGET_COUNT_INVALID:${popupTargets.length}`);

const structure = await withCdpTarget(popupTargets[0], async (session) => {
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => ({
      path: location.pathname,
      identityMatches: String(document.qnaform?.no?.value || "") === ${JSON.stringify(qnaKey)},
      hasSavedAnswer: Boolean(String(document.qnaform?.qca?.value || "").trim()),
      forms: Array.from(document.forms).map((form) => ({
        name: form.name,
        id: form.id,
        action: form.getAttribute("action"),
        method: form.method,
        controls: Array.from(form.elements).map((element) => ({
          tag: element.tagName,
          name: element.name,
          id: element.id,
          type: element.type,
          onclick: element.getAttribute?.("onclick"),
        })),
      })),
      buttons: Array.from(document.querySelectorAll("button,input[type=button],input[type=submit],a"))
        .map((element) => ({
          tag: element.tagName,
          text: String(element.textContent || element.value || "").replace(/\\s+/g, " ").trim(),
          id: element.id,
          name: element.name,
          onclick: element.getAttribute("onclick"),
        }))
        .filter((entry) => entry.text)
        .slice(0, 80),
      globals: Object.getOwnPropertyNames(window)
        .filter((name) => /qna|answer|reply|save|submit|send|trans/i.test(name))
        .slice(0, 120),
      functions: Object.fromEntries([
        "qna_submit",
        "qna_move_pre_submit",
        "qna_move_after_submit",
      ].filter((name) => typeof globalThis[name] === "function")
        .map((name) => [name, String(globalThis[name])])),
    }))()`,
    returnByValue: true,
    awaitPromise: true,
  }, 10_000);
  await session.send("Runtime.evaluate", { expression: "window.close(); true", userGesture: true }, 5_000).catch(() => null);
  if (result.exceptionDetails) throw new Error("SHOPLING_QNA_REPLY_STRUCTURE_EVALUATION_FAILED");
  return result.result?.value;
}, { timeoutMs: 15_000 });

process.stdout.write(`${JSON.stringify({ qnaKey, ...structure }, null, 2)}\n`);
