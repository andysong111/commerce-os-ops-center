import { loadConfig } from "../src/config.mjs";
import { listChromeTargets, shoplingTargets, withCdpTarget } from "../src/chrome-cdp.mjs";

const B13_URL = "https://a.shopling.co.kr/qna/qnaList.phtml";
const config = loadConfig();
const listed = await listChromeTargets(config);
const targets = shoplingTargets(listed.targets, config.shoplingOrigins);
if (targets.length !== 1) throw new Error(`SHOPLING_QNA_TARGET_COUNT_INVALID:${targets.length}`);

const structure = await withCdpTarget(targets[0], async (session) => {
  await session.send("Page.enable", {}, 5_000);
  await session.send("Page.navigate", { url: B13_URL }, 10_000);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => ({
      path: location.pathname,
      title: document.title,
      forms: Array.from(document.forms).map((form) => ({
        name: form.name,
        id: form.id,
        action: form.getAttribute("action"),
        method: form.method,
        controls: Array.from(form.elements).slice(0, 120).map((element) => ({
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
          href: element.getAttribute("href"),
        }))
        .filter((entry) => /답변|전송|검색/.test(entry.text))
        .slice(0, 120),
      globals: Object.getOwnPropertyNames(window)
        .filter((name) => /qna|answer|reply|send|trans/i.test(name))
        .slice(0, 120),
      functions: {
        qnasend_submit_sp: typeof qnasend_submit_sp === "function"
          ? String(qnasend_submit_sp)
          : "",
        qnasend_submit: typeof qnasend_submit === "function"
          ? String(qnasend_submit)
          : "",
      },
      qnaRows: Array.from(document.querySelectorAll('input[name="chk[]"]')).slice(0, 30)
        .map((checkbox) => {
          const row = checkbox.closest("tr");
          const replyButton = row?.querySelector('[onclick*="qna_popup"]');
          const match = String(replyButton?.getAttribute("onclick") || "")
            .match(/qna_popup\\(\\s*['"]([^'"]+)['"]/);
          return {
            qnaKey: match?.[1] || "",
            checkboxValue: checkbox.value,
            checkboxDisabled: checkbox.disabled,
            sendStatus: checkbox.getAttribute("status") || "",
            ableValue: row?.querySelector('input[name="qna_able_list[]"]')?.value || "",
            cells: Array.from(row?.cells || [])
              .map((cell) => String(cell.innerText || "").replace(/\\s+/g, " ").trim())
              .filter(Boolean)
              .slice(-3),
          };
        }),
    }))()`,
    returnByValue: true,
    awaitPromise: true,
  }, 10_000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "SHOPLING_QNA_STRUCTURE_EVALUATION_FAILED");
  }
  return result.result?.value;
}, { timeoutMs: 15_000 });

process.stdout.write(`${JSON.stringify(structure, null, 2)}\n`);
