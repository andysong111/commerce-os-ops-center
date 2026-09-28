import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { captureTargetScreenshot, listChromeTargets, shoplingTargets, withCdpTarget } from "./chrome-cdp.mjs";
import { writeDiagnosticFiles } from "./files.mjs";
import { compactString, redactStructuredData, redactUrl, sanitizeError } from "./safe-json.mjs";

function shoplingDiagnosticProbe(goodsKeyInput) {
  const goodsKey = String(goodsKeyInput || "");
  const cleanText = (value, limit = 500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const sensitiveField = /(?:token|access[_-]?token|refresh[_-]?token|secret|session|password|passwd|pwd|cookie|authorization|bearer|jwt|api[_-]?key|csrf)/i;
  const labelFor = (element) => {
    const id = element.id;
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    if (explicit) return cleanText(explicit.innerText || explicit.textContent);
    const wrapped = element.closest("label");
    if (wrapped) return cleanText(wrapped.innerText || wrapped.textContent);
    const cell = element.closest("td,th,div,li");
    return cleanText(cell?.innerText || cell?.textContent, 160);
  };
  const selectedOptionText = (select) => cleanText(select.selectedOptions?.[0]?.textContent || "");
  const selects = [...document.querySelectorAll("select")].map((select) => ({
    name: select.name || "",
    id: select.id || "",
    value: select.value || "",
    selectedText: selectedOptionText(select),
    label: labelFor(select),
    optionsCount: select.options?.length || 0,
  }));
  const inputs = [...document.querySelectorAll("input,textarea")].map((input) => {
    const type = input.getAttribute("type") || "";
    const name = input.getAttribute("name") || "";
    const id = input.id || "";
    const label = labelFor(input);
    const autocomplete = input.getAttribute("autocomplete") || "";
    const shouldRedact = type === "password" || type === "hidden" || sensitiveField.test(`${name} ${id} ${label} ${autocomplete}`);
    return {
      tag: input.tagName.toLowerCase(),
      type,
      name,
      id,
      value: shouldRedact ? "[redacted]" : cleanText(input.value || "", 300),
      label,
    };
  });
  const searchDropdown =
    selects.find((select) => /검색|search|상품코드|샵플링상품코드|goods/i.test(`${select.name} ${select.id} ${select.label} ${select.selectedText}`)) ||
    selects[0] ||
    null;
  const searchInput =
    inputs.find((input) => goodsKey && input.value.includes(goodsKey)) ||
    inputs.find((input) => /검색|search|keyword|goods|상품/i.test(`${input.name} ${input.id} ${input.label}`) && !/hidden|checkbox|radio|password/i.test(input.type)) ||
    inputs.find((input) => !/hidden|checkbox|radio|password/i.test(input.type)) ||
    null;
  const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')].map((checkbox) => ({
    name: checkbox.name || "",
    id: checkbox.id || "",
    value: checkbox.value || "",
    checked: Boolean(checkbox.checked),
    label: labelFor(checkbox),
    disabled: Boolean(checkbox.disabled),
  }));
  const bodyText = cleanText(document.body?.innerText || "", 5_000);
  const resultCountMatch =
    bodyText.match(/(?:총\s*건수|총\s*검색\s*결과|검색\s*결과|조회\s*결과|Total)[^\d]{0,20}([0-9,]+)/i) ||
    bodyText.match(/([0-9,]+)\s*(?:건|개)\s*(?:검색|조회|결과)/);
  const tables = [...document.querySelectorAll("table")].slice(0, 8).map((table) => ({
    caption: cleanText(table.caption?.innerText || ""),
    headers: [...table.querySelectorAll("th")].slice(0, 20).map((th) => cleanText(th.innerText || th.textContent, 80)),
    rowCount: table.querySelectorAll("tbody tr, tr").length,
    sampleRows: [...table.querySelectorAll("tr")].slice(0, 5).map((row) =>
      [...row.children].slice(0, 8).map((cell) => cleanText(cell.innerText || cell.textContent, 120)),
    ),
  }));
  const headings = [...document.querySelectorAll("h1,h2,h3,.title,.tit")].slice(0, 20).map((node) => cleanText(node.innerText || node.textContent, 120));
  const forms = [...document.querySelectorAll("form")].slice(0, 6).map((form) => ({
    id: form.id || "",
    name: form.getAttribute("name") || "",
    action: form.getAttribute("action") || "",
    method: form.getAttribute("method") || "",
    fieldCount: form.querySelectorAll("input,select,textarea,button").length,
  }));
  let pageRole = "SHOPLING_PAGE";
  if (/상품\s*수정전송|goods_mallMdfy_trsmt/i.test(`${bodyText} ${location.href}`)) pageRole = "A21_POPUP";
  else if (/쇼핑몰상품수정|검색항목/i.test(bodyText)) pageRole = "A21_LIST";
  else if (/옵션대량수정/i.test(bodyText)) pageRole = "A6";
  else if (/상품조회수정/i.test(bodyText)) pageRole = "A4";

  return {
    url: location.href,
    goodsKey,
    title: document.title || "",
    pageRole,
    currentSearchDropdownValue: searchDropdown ? searchDropdown.selectedText || searchDropdown.value : null,
    currentSearchDropdown: searchDropdown,
    searchInputValue: searchInput ? searchInput.value : null,
    searchInput,
    checkboxes,
    resultCount: resultCountMatch ? Number(resultCountMatch[1].replace(/,/g, "")) : null,
    domCore: {
      headings,
      forms,
      selects,
      inputs: inputs.slice(0, 40),
      tables,
      bodyTextSample: bodyText.slice(0, 1_500),
    },
  };
}

export function buildDiagnosticExpression(goodsKey) {
  return `(${shoplingDiagnosticProbe.toString()})(${JSON.stringify(goodsKey || "")})`;
}

export async function evaluateShoplingDiagnostic(target, goodsKey, options = {}) {
  return withCdpTarget(target, async (session) => {
    const result = await session.send("Runtime.evaluate", {
      expression: buildDiagnosticExpression(goodsKey),
      returnByValue: true,
      awaitPromise: true,
    }, options.timeoutMs || 5_000);
    return result.result?.value || null;
  }, options);
}

function chooseTarget(targets, goodsKey, targetUrl) {
  if (targetUrl) return targets.find((target) => target.url === targetUrl || target.url.startsWith(targetUrl)) || null;
  if (goodsKey) return targets.find((target) => target.url.includes(goodsKey)) || targets[0] || null;
  return targets[0] || null;
}

export async function createDiagnosticPackage(config, args = {}, deps = {}) {
  const timestamp = new Date().toISOString();
  const diagnosticId = `${timestamp.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const cdp = await (deps.listChromeTargets || listChromeTargets)(config);
  const shopling = shoplingTargets(cdp.targets || [], config.shoplingOrigins);
  const target = chooseTarget(shopling, args.goodsKey, args.targetUrl);
  const errors = [];
  let page = null;
  let screenshot = null;

  if (!cdp.available) errors.push({ code: "CHROME_CDP_UNAVAILABLE", message: cdp.error?.message || "Chrome DevTools endpoint is unavailable." });
  if (!target) errors.push({ code: "SHOPLING_TAB_NOT_FOUND", message: "No Shopling tab is visible through Chrome DevTools." });

  if (target) {
    try {
      page = await (deps.evaluateShoplingDiagnostic || evaluateShoplingDiagnostic)(target, args.goodsKey || "", deps);
    } catch (error) {
      errors.push(sanitizeError(error, "SHOPLING_DIAGNOSTIC_EVALUATION_FAILED"));
    }
    if (config.screenshotsEnabled) {
      try {
        screenshot = await (deps.captureTargetScreenshot || captureTargetScreenshot)(target, deps);
      } catch (error) {
        errors.push(sanitizeError(error, "SHOPLING_SCREENSHOT_FAILED"));
      }
    }
  }

  const safePage = redactStructuredData(page);
  const diagnostic = {
    schemaVersion: 1,
    diagnosticId,
    timestamp,
    agentVersion: config.agentVersion,
    agentId: config.agentId,
    url: redactUrl(safePage?.url || target?.url || args.targetUrl || ""),
    goodsKey: compactString(safePage?.goodsKey || args.goodsKey || "", 120),
    currentSearchDropdownValue: safePage?.currentSearchDropdownValue ?? null,
    currentSearchDropdown: safePage?.currentSearchDropdown ?? null,
    searchInputValue: safePage?.searchInputValue ?? null,
    searchInput: safePage?.searchInput ?? null,
    checkboxes: safePage?.checkboxes || [],
    resultCount: safePage?.resultCount ?? null,
    pageRole: safePage?.pageRole || (target ? "SHOPLING_PAGE" : "UNKNOWN"),
    domCore: safePage?.domCore || null,
    target: target
      ? {
          id: target.id,
          type: target.type,
          title: target.title,
          url: redactUrl(target.url),
        }
      : null,
    chromeDevTools: {
      available: cdp.available,
      endpoint: cdp.endpoint,
    },
    screenshotPath: screenshot ? join(config.diagnosticsDir, `${diagnosticId}.png`) : null,
    errors,
  };

  const written = await writeDiagnosticFiles(config, diagnostic, screenshot);
  return written.diagnostic;
}
