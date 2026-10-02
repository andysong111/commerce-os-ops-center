import { CdpSession } from "../src/chrome-cdp.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { resolve } from "node:path";

const DEBUG_BASE_URL = "http://127.0.0.1:9222";
const B12_URL = "https://a.shopling.co.kr/order/dlvy_list.phtml";
const LABEL_SETTINGS_URL = "https://a.shopling.co.kr/order/dlvy_print_setting.phtml";
const LABEL_DOCUMENT_URL = "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestLegacyTls(url, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = https.request(url, {
      method,
      headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) },
      ciphers: "DEFAULT@SECLEVEL=1",
      rejectUnauthorized: true,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolveRequest({
        status: response.statusCode || 0,
        url,
        body: Buffer.concat(chunks),
        contentType: String(response.headers["content-type"] || ""),
      }));
    });
    request.on("error", rejectRequest);
    request.end(body);
  });
}

async function shoplingTarget(preferredUrl = "") {
  const targets = await fetch(`${DEBUG_BASE_URL}/json/list`).then((response) => response.json());
  const shopling = targets.filter((target) => target.type === "page" && target.url.startsWith("https://a.shopling.co.kr/"));
  return shopling.find((target) => target.url === preferredUrl) || shopling[0];
}

async function evaluate(session, expression, timeoutMs = 10_000) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Shopling page evaluation failed.");
  return result.result?.value;
}

async function inspect(session) {
  return evaluate(session, `(() => {
    const clean = (value, limit = 120) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const option = (element) => ({
      text: clean(element.selectedOptions?.[0]?.textContent),
      value: clean(element.value),
    });
    const resultMatch = (document.body?.innerText || "").match(/총\\s*조회수\\s*:?\\s*([0-9,]+)\\s*건/);
    return {
      url: location.href,
      title: document.title,
      accountHeader: clean((document.body?.innerText || '').match(/[^\\n]*\[[A-Za-z0-9@._-]+\][^\\n]*/)?.[0] || '', 160),
      resultCount: resultMatch ? Number(resultMatch[1].replace(/,/g, "")) : null,
      resultLines: (document.body?.innerText || "").split(/\\n/).map((line) => clean(line, 200)).filter((line) => /조회수|검색 버튼/.test(line)).slice(0, 20),
      selects: Array.from(document.querySelectorAll("select")).map((element, index) => ({
        index,
        id: clean(element.id),
        name: clean(element.name),
        onchange: clean(element.getAttribute('onchange'), 240),
        selected: option(element),
        options: Array.from(element.options).slice(0, 30).map((item) => ({ text: clean(item.textContent), value: clean(item.value) })),
      })),
      inputs: Array.from(document.querySelectorAll("input")).map((element, index) => ({
        index,
        id: clean(element.id),
        name: clean(element.name),
        type: clean(element.type),
        value: /^(?:text|button|submit)$/i.test(element.type) ? clean(element.value) : "",
        checked: Boolean(element.checked),
      })).filter((entry) => entry.type !== "hidden"),
      buttons: Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], a")).map((element, index) => ({
        index,
        tag: element.tagName,
        id: clean(element.id),
        name: clean(element.name),
        text: clean(element.textContent || element.value),
        href: element.tagName === "A" ? clean(element.getAttribute("href")) : "",
        onclick: clean(element.getAttribute("onclick"), 240),
      })).filter((entry) => entry.text && /검색|조회|전체|송장|출력|택배|적용/.test(entry.text)),
      forms: Array.from(document.forms).map((form, index) => ({
        index,
        id: clean(form.id),
        name: clean(form.name),
        action: clean(form.action, 240),
        method: clean(form.method),
      })),
      searchFunction: typeof srch_submit === 'function' ? clean(srch_submit.toString(), 1200) : '',
      tables: Array.from(document.querySelectorAll('table')).map((table, index) => ({
        index,
        rowCount: table.rows.length,
        headers: Array.from(table.querySelectorAll('th')).map((cell) => clean(cell.textContent)).filter(Boolean).slice(0, 40),
        actionLabels: Array.from(table.querySelectorAll('button, input[type=button], input[type=submit], a')).map((element) => clean(element.textContent || element.value)).filter((text) => /송장|택배|전체|선택|출력/.test(text)).slice(0, 40),
      })).filter((entry) => entry.rowCount > 1 || entry.headers.length),
      stateTextCounts: (() => {
        const counts = {};
        for (const row of document.querySelectorAll('table tr')) {
          const tokens = clean(row.textContent, 2000).match(/[가-힣A-Za-z0-9()]+(?:전송|송장|배송|발송|검수|완료|대기|출력)[가-힣A-Za-z0-9()]*/g) || [];
          for (const token of new Set(tokens)) counts[token] = (counts[token] || 0) + 1;
        }
        return counts;
      })(),
      stateFields: Array.from(document.querySelectorAll('input, select')).filter((element) => /(?:dlvy|status|print|trsmt)/i.test((element.name || '') + ' ' + (element.id || ''))).map((element) => ({
        name: clean(element.name || element.id),
        value: /^(?:Y|N|O|E|001|002|003|999|[A-Z_]{1,20})$/.test(String(element.value || '')) ? clean(element.value) : '[redacted]',
      })).reduce((summary, item) => {
        const key = item.name + '=' + item.value;
        summary[key] = (summary[key] || 0) + 1;
        return summary;
      }, {}),
      orderStatusCounts: Array.from(document.querySelectorAll('input[name^="ord_status_"]')).reduce((summary, element) => {
        const value = String(element.value || '').slice(0, 20);
        summary[value] = (summary[value] || 0) + 1;
        return summary;
      }, {}),
      orderStatusLabels: Array.from(document.querySelectorAll('input[name^="ord_status_"]')).reduce((summary, element) => {
        const status = String(element.value || '').slice(0, 20);
        const labels = Array.from(element.closest('tr')?.querySelectorAll('button, input[type="button"]') || []).map((button) => clean(button.textContent || button.value)).filter(Boolean).join('|');
        const key = status + ':' + labels;
        summary[key] = (summary[key] || 0) + 1;
        return summary;
      }, {}),
      controlFields: Array.from(document.querySelectorAll('input[type="hidden"]')).filter((element) => element.name && (!/\\d/.test(element.name) || element.name === 'A05_Y')).map((element) => ({
        name: clean(element.name),
        value: /^[A-Za-z0-9_:-]{0,30}$/.test(String(element.value || '')) ? clean(element.value) : '[redacted]',
      })).slice(0, 120),
    };
  })()`);
}

async function prepare(session, date, status = "002", invoiceState = "", includeCompleted = "") {
  return evaluate(session, `(() => {
    const setValue = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Missing Shopling control: ' + selector);
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('select[name="srch_dt"]', 'srch_dt_i_dt');
    setValue('#s_dt', ${JSON.stringify(date)});
    setValue('#e_dt', ${JSON.stringify(date)});
    setValue('#row_cnt', '1000');
    setValue('#dlvy_status_tp', ${JSON.stringify(status)});
    setValue('#dlvyno_tp', ${JSON.stringify(invoiceState)});
    setValue('input[name="A05_Y"]', ${JSON.stringify(includeCompleted)});
    setValue('select[name="sort_tp"]', 'sort_tp_ptn_opt_cd');
    setValue('#sort', 'asc');
    setValue('select[name="sort_tp_second"]', 'A');
    setValue('select[name="sort_second"]', 'asc');
    if (typeof srch_submit !== 'function') throw new Error('Shopling search function is unavailable.');
    srch_submit();
    return true;
  })()`);
}

const command = process.argv[2] || "inspect";
const preferredUrl = ["inspect-document", "inspect-document-ax", "probe-document-pdf", "print-document", "print-document-runtime"].includes(command)
  ? LABEL_DOCUMENT_URL
  : command === "inspect-settings" || command === "open-label-document" || command === "post-label-document" || command === "settings-source" || command === "settings-html-source" || command === "fetch-label-html"
    ? LABEL_SETTINGS_URL
    : B12_URL;
const target = await shoplingTarget(preferredUrl);
if (!target) throw new Error("Dedicated Shopling Chrome tab was not found.");

const session = new CdpSession(target.webSocketDebuggerUrl);
await session.connect(5_000);

try {
  if (command === "close-browser") {
    await session.send("Browser.close", {}, 5_000).catch(() => null);
    console.log(JSON.stringify({ closeRequested: true }, null, 2));
    process.exit(0);
  }
  if (command === "browser-command-line") {
    const browser = await session.send("Browser.getBrowserCommandLine", {}, 5_000);
    console.log(JSON.stringify(browser, null, 2));
    process.exit(0);
  }
  if (command === "probe-command-line-page") {
    const created = await session.send("Target.createTarget", { url: "chrome://version/" }, 5_000);
    await sleep(1_000);
    const targets = await fetch(`${DEBUG_BASE_URL}/json/list`).then((response) => response.json());
    const versionTarget = targets.find((item) => item.id === created.targetId);
    if (!versionTarget) throw new Error("Chrome version target was not found.");
    const versionSession = new CdpSession(versionTarget.webSocketDebuggerUrl);
    await versionSession.connect(5_000);
    try {
      const pageText = await evaluate(versionSession, `document.body?.innerText || ''`, 10_000);
      const commandLine = String(pageText).split(/\n/).find((line) => line.includes('--remote-debugging-port')) || '';
      console.log(JSON.stringify({
        hasKioskPrinting: commandLine.includes('--kiosk-printing'),
        hasEnableAutomation: commandLine.includes('--enable-automation'),
        commandLine,
      }, null, 2));
    } finally {
      versionSession.close();
      await session.send("Target.closeTarget", { targetId: created.targetId }, 5_000).catch(() => null);
    }
    process.exit(0);
  }
  if (command === "settings-html-source") {
    const tree = await session.send('Page.getResourceTree', {}, 10_000);
    const frame = tree.frameTree.frame;
    const resource = await session.send('Page.getResourceContent', { frameId: frame.id, url: frame.url }, 10_000);
    const html = String(resource.content || '');
    const matches = [];
    for (const name of ['print_act_test2', 'print_act']) {
      const index = html.indexOf('function ' + name);
      if (index >= 0) matches.push(html.slice(index, index + 5_000));
    }
    console.log(matches.join('\n---FUNCTION---\n'));
    process.exit(0);
  }
  if (command === "open-settings-a04") {
    const expectedCount = Number(process.argv[3]);
    if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
      throw new Error("open-settings-a04 requires a positive expected row count.");
    }
    const requestedOrderNumbers = String(process.argv[4] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (requestedOrderNumbers.length > 0
      && (requestedOrderNumbers.length !== expectedCount || requestedOrderNumbers.some((value) => !/^\d+$/.test(value)))) {
      throw new Error("Explicit Shopling order numbers must be numeric and match the expected row count.");
    }
    const selected = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.forms.frm;
        if (!form || typeof dlvy_print !== 'function') throw new Error('Shopling label function is unavailable.');
        const statusInputs = Array.from(document.querySelectorAll('input[name^="ord_status_"]'));
        const requested = new Set(${JSON.stringify(requestedOrderNumbers)});
        const matchingInputs = statusInputs.filter((input) => {
          const orderNumber = String(input.name || '').replace(/^ord_status_/, '');
          return input.value === 'A04' && (requested.size === 0 || requested.has(orderNumber));
        });
        const targetRows = matchingInputs.map((input) => input.closest('tr')).filter(Boolean);
        if (targetRows.length !== ${expectedCount}) throw new Error('Expected exactly ${expectedCount} A04 rows, found ' + targetRows.length + '.');
        const allChecks = Array.from(document.querySelectorAll('input[name="chk[]"]'));
        allChecks.forEach((checkbox) => { checkbox.checked = false; });
        for (const row of targetRows) {
          const checkbox = row.querySelector('input[name="chk[]"]');
          if (!checkbox) throw new Error('A04 row is missing its selection checkbox.');
          checkbox.checked = true;
        }
        let courier = form.elements.namedItem('dlvy_id');
        if (!courier) {
          courier = document.createElement('input');
          courier.type = 'hidden';
          courier.name = 'dlvy_id';
          form.appendChild(courier);
        }
        courier.value = '018';
        dlvy_print();
        return {
          selectedCount: allChecks.filter((checkbox) => checkbox.checked).length,
          selectedOrderNumbers: matchingInputs.map((input) => String(input.name || '').replace(/^ord_status_/, '')),
          courier: courier.value,
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, 15_000);
    await sleep(2_000);
    const targets = await fetch(`${DEBUG_BASE_URL}/json/list`).then((response) => response.json());
    const settings = targets.find((item) => item.type === 'page' && item.url.includes('/order/dlvy_print_setting.phtml'));
    console.log(JSON.stringify({ ...selected.result?.value, settingsTargetId: settings?.id || null, settingsUrl: settings?.url || null }, null, 2));
    process.exit(0);
  }
  if (command === "inspect-settings") {
    await session.send("Page.handleJavaScriptDialog", { accept: true }, 5_000).catch(() => null);
    const settingsState = await evaluate(session, `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const hidden = (name) => document.querySelector('input[name="' + name + '"]');
      return {
        url: location.href,
        hasPrintButton: Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]')).some((element) => clean(element.textContent || element.value) === '송장출력'),
        courierIdLength: String(hidden('dlvy_id')?.value || '').length,
        orderArrayLength: String(hidden('ord_no_arr')?.value || '').length,
        orderCount: (String(hidden('ord_no_arr')?.value || '').match(/[0-9]+/g) || []).length,
        printStyle: document.querySelector('select[name="print_style"]')?.selectedOptions?.[0]?.textContent?.trim() || '',
        selectedFields: Array.from(document.querySelectorAll('select[name^="prod_print_info_"]')).map((select) => clean(select.selectedOptions?.[0]?.textContent)),
        checkedRadios: Array.from(document.querySelectorAll('input[type="radio"]:checked')).map((radio) => ({ name: clean(radio.name), value: clean(radio.value) })),
      };
    })()`);
    console.log(JSON.stringify(settingsState, null, 2));
    process.exit(0);
  }
  if (command === "fetch-label-html") {
    const serialized = await evaluate(session, `(() => {
      const form = document.forms.frm;
      if (!form) throw new Error('Shopling label settings form is unavailable.');
      const params = new URLSearchParams(new FormData(form));
      params.set('mode', 'print_act');
      return {
        body: params.toString(),
        courier: String(form.elements.namedItem('dlvy_id')?.value || ''),
        style: String(form.elements.namedItem('print_style')?.value || ''),
        orderCount: (String(form.elements.namedItem('ord_no_arr')?.value || '').match(/[0-9]+/g) || []).length,
      };
    })()`);
    if (serialized.courier !== '018' || serialized.style !== '003' || serialized.orderCount !== 33) {
      throw new Error('Unexpected Shopling label form state.');
    }
    const cookieResult = await session.send('Network.getAllCookies', {}, 10_000);
    const cookieHeader = (cookieResult.cookies || [])
      .filter((cookie) => /(?:^|\.)shopling\.co\.kr$/i.test(cookie.domain))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const response = await requestLegacyTls(LABEL_DOCUMENT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader,
        origin: 'https://a.shopling.co.kr',
        referer: LABEL_SETTINGS_URL,
      },
      body: serialized.body,
    });
    const html = response.body.toString('utf8');
    const outputDir = resolve('local-agent', 'data', 'labels');
    const outputPath = resolve(outputDir, 'shopling-label-source.html');
    const standalonePath = resolve(outputDir, 'shopling-label-standalone.html');
    const assetDir = resolve(outputDir, 'assets');
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, html, 'utf8');
    await rm(assetDir, { recursive: true, force: true });
    await mkdir(assetDir, { recursive: true });
    const imageSources = [...new Set(Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi), (match) => match[1]))];
    const localized = new Map();
    for (const [index, source] of imageSources.entries()) {
      if (/^data:/i.test(source)) continue;
      const assetUrl = new URL(source, LABEL_DOCUMENT_URL).href;
      const asset = await requestLegacyTls(assetUrl, {
        headers: { cookie: cookieHeader, referer: LABEL_DOCUMENT_URL },
      });
      if (asset.status !== 200 || !asset.body.length) throw new Error(`Could not download label asset ${index + 1}.`);
      const extension = /png/i.test(asset.contentType) ? '.png'
        : /jpe?g/i.test(asset.contentType) ? '.jpg'
          : /gif/i.test(asset.contentType) ? '.gif'
            : '.bin';
      const name = `asset-${String(index + 1).padStart(3, '0')}${extension}`;
      await writeFile(resolve(assetDir, name), asset.body);
      localized.set(source, `assets/${name}`);
    }
    let standalone = html
      .replace(/<div\b[^>]*id=["']loading["'][^>]*>[\s\S]*?<\/div>/i, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    standalone = standalone.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, source) => (
      `${prefix}${quote}${localized.get(source) || source}${quote}`
    ));
    standalone = `<style>
      @page { size: 109mm 127mm; margin: 0 11pt; }
      div.page { break-after: page !important; page-break-after: always !important; break-inside: avoid !important; }
      div.page:last-of-type { break-after: auto !important; page-break-after: auto !important; }
    </style>${standalone}`;
    await writeFile(standalonePath, standalone, 'utf8');
    console.log(JSON.stringify({
      status: response.status,
      finalUrl: response.url,
      bytes: Buffer.byteLength(html),
      imageCount: (html.match(/<img\b/gi) || []).length,
      localizedImageCount: localized.size,
      pageMarkerCount: (html.match(/\[\d+\s*\/\s*31\]/g) || []).length,
      outputPath,
      standalonePath,
    }, null, 2));
    process.exit(0);
  }
  if (command === "open-label-document") {
    const invocation = session.send("Runtime.evaluate", {
      expression: `(() => {
        if (typeof print_act_test2 !== 'function') throw new Error('Shopling print action is unavailable.');
        print_act_test2();
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, 20_000);
    await sleep(400);
    await session.send("Page.handleJavaScriptDialog", { accept: false }, 5_000).catch(() => null);
    await invocation.catch(() => null);
    await sleep(2_000);
    const targets = await fetch(`${DEBUG_BASE_URL}/json/list`).then((response) => response.json());
    const documentTarget = targets.find((item) => item.type === 'page' && item.url.includes('/order/dlvy_print/018_003_chrome.phtml'));
    console.log(JSON.stringify({ documentTargetId: documentTarget?.id || null, documentUrl: documentTarget?.url || null }, null, 2));
    process.exit(0);
  }
  if (command === "post-label-document") {
    const posted = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.forms.frm;
        const courier = String(form?.elements?.namedItem('dlvy_id')?.value || '');
        const style = String(form?.elements?.namedItem('print_style')?.value || '');
        const orders = String(form?.elements?.namedItem('ord_no_arr')?.value || '');
        const orderCount = (orders.match(/[0-9]+/g) || []).length;
        if (!form || courier !== '018' || style !== '003' || orderCount !== 33) {
          throw new Error('Unexpected Shopling label form state.');
        }
        form.target = '_self';
        form.action = '/order/dlvy_print/018_003_chrome.phtml';
        form.method = 'post';
        form.elements.namedItem('mode').value = 'print_act';
        setTimeout(() => form.submit(), 0);
        return { courier, style, orderCount };
      })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, 10_000);
    await sleep(3_000);
    const targets = await fetch(`${DEBUG_BASE_URL}/json/list`).then((response) => response.json());
    const documentTarget = targets.find((item) => item.type === 'page' && item.id === target.id);
    console.log(JSON.stringify({ ...posted.result?.value, targetId: target.id, url: documentTarget?.url || null }, null, 2));
    process.exit(0);
  }
  if (command === "settings-source") {
    const source = await evaluate(session, `({
      print: typeof print_act_test2 === 'function' ? print_act_test2.toString() : '',
      submit: typeof print_act === 'function' ? print_act.toString() : ''
    })`);
    console.log(JSON.stringify(source, null, 2));
    process.exit(0);
  }
  if (command === "open-document") {
    const created = await session.send("Target.createTarget", { url: LABEL_DOCUMENT_URL }, 10_000);
    console.log(JSON.stringify({ targetId: created.targetId, url: LABEL_DOCUMENT_URL }, null, 2));
    process.exit(0);
  }
  if (command === "inspect-document") {
    await session.send("Page.handleJavaScriptDialog", { accept: true }, 5_000).catch(() => null);
    await sleep(1_000);
    const documentState = await evaluate(session, `(() => {
      const text = document.body?.innerText || '';
      const pages = Array.from(text.matchAll(/\\[(\\d+)\\s*\\/\\s*(\\d+)\\]/g));
      const pageCount = pages.reduce((maximum, match) => Math.max(maximum, Number(match[2]) || 0), 0);
      const images = Array.from(document.images);
      return { url: location.href, pageCount, imageCount: images.length, loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length, bodyHeight: document.body?.scrollHeight || 0 };
    })()`, 20_000);
    console.log(JSON.stringify(documentState, null, 2));
    process.exit(0);
  }
  if (command === "inspect-document-ax") {
    await session.send("Accessibility.enable", {}, 5_000).catch(() => null);
    const tree = await session.send("Accessibility.getFullAXTree", {}, 30_000);
    const values = tree.nodes
      .map((node) => String(node.name?.value || node.value?.value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const pageMarkers = values.flatMap((value) => Array.from(value.matchAll(/\[(\d+)\s*\/\s*(\d+)\]/g)));
    console.log(JSON.stringify({
      url: target.url,
      nodeCount: tree.nodes.length,
      pageCount: pageMarkers.reduce((maximum, match) => Math.max(maximum, Number(match[2]) || 0), 0),
      sample: values.slice(0, 40),
    }, null, 2));
    process.exit(0);
  }
  if (command === "probe-document-pdf") {
    await session.send("Page.enable", {}, 5_000).catch(() => null);
    const pdf = await session.send("Page.printToPDF", {
      landscape: false,
      printBackground: false,
      preferCSSPageSize: true,
      returnAsStream: true,
    }, 60_000);
    let totalBytes = 0;
    let eof = false;
    while (!eof) {
      const chunk = await session.send("IO.read", { handle: pdf.stream, size: 1_048_576 }, 30_000);
      totalBytes += Buffer.byteLength(chunk.data || "", chunk.base64Encoded ? "base64" : "utf8");
      eof = Boolean(chunk.eof);
    }
    await session.send("IO.close", { handle: pdf.stream }, 5_000).catch(() => null);
    console.log(JSON.stringify({ url: target.url, pdfBytes: totalBytes }, null, 2));
    process.exit(0);
  }
  if (command === "print-document") {
    await session.send("Page.bringToFront", {}, 5_000);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 162,
      modifiers: 2,
    }, 5_000);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "p",
      code: "KeyP",
      windowsVirtualKeyCode: 80,
      nativeVirtualKeyCode: 80,
      modifiers: 2,
    }, 5_000);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "p",
      code: "KeyP",
      windowsVirtualKeyCode: 80,
      nativeVirtualKeyCode: 80,
      modifiers: 2,
    }, 5_000);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 162,
      modifiers: 0,
    }, 5_000);
    console.log(JSON.stringify({ url: target.url, printShortcutDispatched: true }, null, 2));
    process.exit(0);
  }
  if (command === "print-document-runtime") {
    await session.send("Page.bringToFront", {}, 5_000);
    const result = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const readyState = document.readyState;
        window.print();
        return { invoked: true, readyState };
      })()`,
      returnByValue: true,
      awaitPromise: false,
      userGesture: true,
    }, 60_000);
    console.log(JSON.stringify({
      url: target.url,
      ...result.result?.value,
    }, null, 2));
    process.exit(0);
  }
  if (command === "navigate" && target.url !== B12_URL) {
    await session.send("Page.enable", {}, 5_000);
    await session.send("Page.navigate", { url: B12_URL }, 10_000);
    await sleep(2_500);
  }
  if (command === "prepare") {
    const date = process.argv[3] || new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const status = process.argv[4] ?? "002";
    const invoiceState = process.argv[5] ?? "";
    const includeCompleted = process.argv[6] ?? "";
    const printState = process.argv[7] ?? "";
    if (!/^\d{8}$/.test(date)) throw new Error("Expected date in YYYYMMDD format.");
    if (!["", "001", "002", "003", "999"].includes(status)) throw new Error("Unsupported courier status.");
    if (!["", "Y", "N"].includes(invoiceState)) throw new Error("Unsupported invoice state.");
    if (!["", "Y"].includes(includeCompleted)) throw new Error("Unsupported completed-order flag.");
    if (!["", "A", "Y", "N"].includes(printState)) throw new Error("Unsupported print state.");
    await prepare(session, date, status, invoiceState, includeCompleted);
    await sleep(3_000);
    if (printState) {
      await evaluate(session, `(() => {
        const printState = document.querySelector('select[name="dlvy_print_tp"]');
        if (!printState) throw new Error('Shopling print-state control is unavailable.');
        printState.value = ${JSON.stringify(printState)};
        printState.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof srch_submit !== 'function') throw new Error('Shopling search function is unavailable.');
        srch_submit();
        return true;
      })()`);
      await sleep(3_000);
    }
  }
  if (command === "status-binding") {
    const binding = await evaluate(session, `(() => {
      const visible = document.querySelector('#dlvy_status_tp');
      const hidden = document.querySelector('input[name="send_dlvy_status_tp"]');
      visible.value = '002';
      visible.dispatchEvent(new Event('input', { bubbles: true }));
      visible.dispatchEvent(new Event('change', { bubbles: true }));
      return { visible: visible.value, hidden: hidden?.value || '', outer: visible.outerHTML.slice(0, 500) };
    })()`);
    console.log(JSON.stringify(binding, null, 2));
    process.exit(0);
  }
  if (command === "status-source") {
    const snippets = await evaluate(session, `(() => {
      const source = Array.from(document.scripts).map((script) => script.textContent || '').join('\\n');
      const lines = source.split(/\\n/);
      return lines.map((line, index) => ({ line, index })).filter((entry) => /(?:send_dlvy_status_tp|dlvy_status_tp|A05_Y|dlvy_print)/.test(entry.line)).slice(0, 40).map((entry) => lines.slice(Math.max(0, entry.index - 6), entry.index + 8).map((line) => line.trim()).join(' '));
    })()`);
    console.log(JSON.stringify(snippets, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify(await inspect(session), null, 2));
} finally {
  session.close();
}
