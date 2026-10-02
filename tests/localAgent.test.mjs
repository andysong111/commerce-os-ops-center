import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  evaluateCdpExpressionAcrossFrames,
  flattenCdpFrameTree,
  selectBestShoplingFrameResult,
} from "../local-agent/src/chrome-cdp.mjs";
import { buildDiagnosticExpression, createDiagnosticPackage } from "../local-agent/src/diagnostics.mjs";
import { redactStructuredData, redactUrl } from "../local-agent/src/safe-json.mjs";
import { buildStatusSnapshot } from "../local-agent/src/status.mjs";
import {
  createShoplingOrderPreflight,
  inferShoplingOrderStage,
  SHOPLING_ORDER_PREFLIGHT_EXPRESSION,
} from "../local-agent/src/shopling-order-preflight.mjs";
import {
  buildShoplingLabelPdfOptions,
  captureShoplingLabelPdf,
  extractLabelPageCount,
  selectShoplingLabelTarget,
} from "../local-agent/src/shopling-label-print.mjs";
import {
  buildStandaloneLabelHtml,
  validateShoplingLabelHtmlPageCount,
} from "../local-agent/src/shopling-label-export.mjs";
import { createSupabaseRestHeaders, uploadHeartbeat } from "../local-agent/src/supabase-upload.mjs";
import {
  buildWindowsPdfPrintArgs,
  runWindowsPdfPrint,
  validateWindowsPdfPrintResult,
} from "../local-agent/src/windows-pdf-printer.mjs";

function config(overrides = {}) {
  return {
    agentId: "test-agent",
    agentVersion: "0.1.0",
    dataDir: overrides.dataDir || ".tmp",
    diagnosticsDir: overrides.diagnosticsDir || ".tmp/diagnostics",
    chromeDebugBaseUrl: "http://127.0.0.1:9222",
    shoplingOrigins: ["https://a.shopling.co.kr/"],
    probeShoplingPage: true,
    screenshotsEnabled: true,
    supabaseUploadEnabled: false,
    supabaseUrl: "",
    supabaseSecretKey: "",
    heartbeatTable: "commerce_os_local_agent_heartbeats",
    diagnosticTable: "commerce_os_local_agent_diagnostics",
    ...overrides,
  };
}

test("local agent redacts token-like URL parameters and userinfo", () => {
  const redacted = redactUrl("https://user:pass@a.shopling.co.kr/main.phtml?goods=123&access_token=secret&session=abc");
  assert.equal(redacted.includes("user:pass"), false);
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("session=abc"), false);
  assert.match(redacted, /goods=123/);
  assert.match(redacted, /access_token=%5Bredacted%5D|access_token=\[redacted\]/);
});

test("local agent redacts structured credentials and inline session values", () => {
  const redacted = redactStructuredData({
    goodsKey: "123456",
    sessionToken: "raw-session-token",
    input: { name: "keyword", value: "session=raw-session-value" },
    action: "https://a.shopling.co.kr/main.phtml?csrf=raw-csrf&goods=123456",
  });
  assert.equal(redacted.goodsKey, "123456");
  assert.equal(redacted.sessionToken, "[redacted]");
  assert.equal(redacted.input.value.includes("raw-session-value"), false);
  assert.equal(redacted.action.includes("raw-csrf"), false);
});

test("status heartbeat reports Chrome, Shopling tab, stage and partial A21 signals without product writes", async () => {
  const snapshot = await buildStatusSnapshot(config(), {
    now: () => new Date("2026-09-28T01:02:03.000Z"),
    readAgentState: async () => ({ lastErrorCode: null, currentAutomationStage: "IDLE" }),
    getChromeProcessStatus: async () => ({ running: true, processCount: 2, method: "mock", error: null }),
    listChromeTargets: async () => ({
      available: true,
      endpoint: "http://127.0.0.1:9222",
      error: null,
      targets: [
        {
          id: "1",
          type: "page",
          title: "쇼핑몰상품수정",
          url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml?token=secret",
          webSocketDebuggerUrl: "ws://fixture",
        },
      ],
    }),
    probeShoplingTarget: async () => ({
      url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy.phtml",
      title: "쇼핑몰상품수정",
      role: "A21_LIST",
      a21Globals: ["commerceOsWakeA21MonthlyResult"],
      localStorageKeyHints: ["commerceOsShoplingA21PriceOptionResendV020"],
      textSample: "검색항목 쇼핑몰상품수정",
    }),
  });

  assert.equal(snapshot.timestamp, "2026-09-28T01:02:03.000Z");
  assert.equal(snapshot.chrome.running, true);
  assert.equal(snapshot.shopling.tabsPresent, true);
  assert.equal(snapshot.agent.currentAutomationStage, "A21_LIST");
  assert.match(snapshot.shopling.url, /goods_mallMdfy\.phtml/);
  assert.equal(snapshot.shopling.url.includes("secret"), false);
  assert.deepEqual(snapshot.a21Extension.signals, ["A21_MAIN_WORLD_GLOBAL_PRESENT", "SHOPLING_A21_PAGE_ROLE"]);
});

test("diagnostic packages are saved locally with requested Shopling fields and screenshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-os-local-agent-"));
  try {
    const cfg = config({ dataDir: directory, diagnosticsDir: join(directory, "diagnostics") });
    const diagnostic = await createDiagnosticPackage(cfg, { goodsKey: "123456" }, {
      listChromeTargets: async () => ({
        available: true,
        endpoint: "http://127.0.0.1:9222",
        targets: [{ id: "1", type: "page", title: "A21", url: "https://a.shopling.co.kr/main.phtml", webSocketDebuggerUrl: "ws://fixture" }],
      }),
      evaluateShoplingDiagnostic: async () => ({
        url: "https://a.shopling.co.kr/main.phtml?session=secret",
        goodsKey: "123456",
        pageRole: "A21_LIST",
        currentSearchDropdownValue: "샵플링상품코드",
        searchInputValue: "123456",
        checkboxes: [{ name: "all", checked: true }],
        resultCount: 1,
        domCore: { tables: [{ rowCount: 1 }], bodyTextSample: "검색 결과 1건" },
      }),
      captureTargetScreenshot: async () => Buffer.from("png"),
    });

    assert.equal(diagnostic.goodsKey, "123456");
    assert.equal(diagnostic.currentSearchDropdownValue, "샵플링상품코드");
    assert.equal(diagnostic.searchInputValue, "123456");
    assert.equal(diagnostic.resultCount, 1);
    assert.equal(diagnostic.url.includes("secret"), false);
    assert.equal(diagnostic.checkboxes[0].checked, true);
    const saved = JSON.parse(await readFile(join(directory, "diagnostics", `${diagnostic.diagnosticId}.json`), "utf8"));
    assert.equal(saved.screenshotPath.endsWith(".png"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic page probe contains read-only DOM collection and no mutation verbs", () => {
  const expression = buildDiagnosticExpression("123456");
  assert.match(expression, /querySelectorAll/);
  assert.match(expression, /checkboxes/);
  assert.match(expression, /resultCount/);
  assert.match(expression, /type === "hidden"/);
  assert.match(expression, /sensitiveField/);
  assert.match(expression, /srch_tp/);
  assert.match(expression, /srch_txt/);
  assert.match(expression, /form\[name=/);
  assert.doesNotMatch(expression, /\.click\s*\(/);
  assert.doesNotMatch(expression, /\.submit\s*\(/);
  assert.doesNotMatch(expression, /fetch\s*\(/);
});

test("CDP frame traversal evaluates the active Shopling child frame and selects A4 evidence", async () => {
  const frames = flattenCdpFrameTree({
    frame: { id: "root", url: "https://a.shopling.co.kr/" },
    childFrames: [{ frame: { id: "main", parentId: "root", name: "main", url: "https://a.shopling.co.kr/prod/prodLst.phtml" } }],
  });
  assert.deepEqual(frames.map((frame) => [frame.id, frame.depth]), [["root", 0], ["main", 1]]);

  const calls = [];
  const session = {
    send: async (method, params) => {
      calls.push({ method, params });
      if (method === "Page.enable") return {};
      if (method === "Page.getFrameTree") return {
        frameTree: {
          frame: { id: "root", url: "https://a.shopling.co.kr/" },
          childFrames: [{ frame: { id: "main", parentId: "root", name: "main", url: "https://a.shopling.co.kr/prod/prodLst.phtml" } }],
        },
      };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params.frameId === "root" ? 10 : 20 };
      if (method === "Runtime.evaluate") return params.contextId === 20
        ? { result: { value: { pageRole: "A4", searchInputValue: "123456", domCore: { bodyTextSample: "[A4] 상품조회수정" } } } }
        : { result: { value: { pageRole: "SHOPLING_PAGE", searchInputValue: "", domCore: { bodyTextSample: "" } } } };
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };

  const evaluated = await evaluateCdpExpressionAcrossFrames(session, "(() => ({}))()", { timeoutMs: 100 });
  const selected = selectBestShoplingFrameResult(evaluated, "123456");
  assert.equal(selected.frame.id, "main");
  assert.equal(selected.value.pageRole, "A4");
  assert.deepEqual(calls.filter((call) => call.method === "Runtime.evaluate").map((call) => call.params.contextId), [10, 20]);
});

test("CDP frame traversal falls back to the top document when isolated worlds are blocked", async () => {
  const session = {
    send: async (method, params) => {
      if (method === "Page.enable") return {};
      if (method === "Page.getFrameTree") return {
        frameTree: {
          frame: { id: "root", url: "https://a.shopling.co.kr/main.phtml" },
          childFrames: [{ frame: { id: "main", parentId: "root", name: "main", url: "https://a.shopling.co.kr/prod/prodLst.phtml" } }],
        },
      };
      if (method === "Page.createIsolatedWorld") throw new Error(`Blocked frame ${params.frameId}`);
      if (method === "Runtime.evaluate") return {
        result: {
          value: {
            pageRole: "SHOPLING_MAIN",
            searchInputValue: "",
            domCore: { bodyTextSample: "Shopling main page" },
          },
        },
      };
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };

  const evaluated = await evaluateCdpExpressionAcrossFrames(session, "(() => ({}))()", { timeoutMs: 100 });
  assert.equal(evaluated.length, 1);
  assert.equal(evaluated[0].frame.id, "");
  assert.equal(evaluated[0].value.pageRole, "SHOPLING_MAIN");
});

test("Supabase upload is opt-in and new secret keys are not sent as bearer tokens", async () => {
  assert.equal(createSupabaseRestHeaders("sb_secret_example").Authorization, undefined);
  assert.equal(createSupabaseRestHeaders("legacy.jwt").Authorization, "Bearer legacy.jwt");

  const skipped = await uploadHeartbeat(config(), { timestamp: "2026-09-28T00:00:00Z", agent: { status: "ok" } });
  assert.equal(skipped.skipped, true);

  let request;
  const uploaded = await uploadHeartbeat(
    config({
      supabaseUploadEnabled: true,
      supabaseUrl: "https://example.supabase.co",
      supabaseSecretKey: "sb_secret_example",
    }),
    { timestamp: "2026-09-28T00:00:00Z", agent: { status: "ok" } },
    {
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return new Response(null, { status: 201 });
      },
    },
  );

  assert.equal(uploaded.ok, true);
  assert.equal(request.url, "https://example.supabase.co/rest/v1/commerce_os_local_agent_heartbeats");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.headers.apikey, "sb_secret_example");
  assert.equal(request.url.includes("sb_secret_example"), false);
});

test("Shopling order stages are inferred from known B5, B7, B12 and label URLs", () => {
  assert.equal(inferShoplingOrderStage("https://a.shopling.co.kr/order/mapping2/order_mapping_1n_Lst.phtml"), "B5_MAPPING");
  assert.equal(inferShoplingOrderStage("https://a.shopling.co.kr/order/order_list.phtml"), "B7_ORDER_PROCESSING");
  assert.equal(inferShoplingOrderStage("https://a.shopling.co.kr/order/dlvy_list.phtml"), "B12_COURIER");
  assert.equal(inferShoplingOrderStage("https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml"), "LABEL_DOCUMENT");
});

test("Shopling order preflight is read-only and excludes recipient field collection", () => {
  assert.match(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /querySelectorAll/);
  assert.match(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /selectedOptions/);
  assert.doesNotMatch(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /\.click\s*\(/);
  assert.doesNotMatch(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /\.submit\s*\(/);
  assert.doesNotMatch(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /fetch\s*\(/);
  assert.doesNotMatch(SHOPLING_ORDER_PREFLIGHT_EXPRESSION, /수취인명|주소|전화번호/);
});

test("Shopling order preflight reports the furthest active stage without mutations", async () => {
  const preflight = await createShoplingOrderPreflight(config(), {
    listChromeTargets: async () => ({
      available: true,
      error: null,
      targets: [
        { id: "b12", type: "page", title: "B12", url: "https://a.shopling.co.kr/order/dlvy_list.phtml", webSocketDebuggerUrl: "ws://b12" },
        { id: "label", type: "page", title: "Shopling label", url: "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml", webSocketDebuggerUrl: "ws://label" },
      ],
    }),
    probeShoplingOrderTarget: async (target) => ({
      stage: target.id === "label" ? "LABEL_DOCUMENT" : "B12_COURIER",
      resultCount: target.id === "b12" ? 33 : null,
      labelPageCount: target.id === "label" ? 31 : null,
    }),
  });
  assert.equal(preflight.activeStage, "LABEL_DOCUMENT");
  assert.equal(preflight.shoplingTabCount, 2);
  assert.equal(preflight.safeguards.triggersPrint, false);
});

test("Shopling label PDF profile matches the verified 109x127 mm Chrome settings", () => {
  const options = buildShoplingLabelPdfOptions();
  assert.equal(options.transferMode, "ReturnAsStream");
  assert.equal(options.landscape, false);
  assert.equal(options.printBackground, false);
  assert.equal(options.scale, 1);
  assert.equal(options.paperWidth, 109 / 25.4);
  assert.equal(options.paperHeight, 127 / 25.4);
  assert.equal(options.marginTop, 0);
  assert.equal(options.marginBottom, 0);
  assert.equal(options.marginLeft, 11 / 72);
  assert.equal(options.marginRight, 11 / 72);
});

test("Shopling label page count is extracted and the target must be unique", () => {
  const nodes = [
    { name: { value: "[1/31]" } },
    { value: { value: "[31 / 31]" } },
  ];
  assert.equal(extractLabelPageCount(nodes), 31);
  const target = selectShoplingLabelTarget([
    { id: "label", url: "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml" },
  ]);
  assert.equal(target.id, "label");
  assert.throws(() => selectShoplingLabelTarget([]), { code: "SHOPLING_LABEL_TARGET_COUNT_INVALID" });
  assert.throws(() => selectShoplingLabelTarget([
    { url: "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml" },
    { url: "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml" },
  ]), { code: "SHOPLING_LABEL_TARGET_COUNT_INVALID" });
});

test("Shopling label capture validates page count and writes the streamed PDF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-os-label-pdf-"));
  const outputPath = join(directory, "labels.pdf");
  const calls = [];
  const session = {
    send: async (method, params) => {
      calls.push({ method, params });
      if (["Page.enable", "Accessibility.enable", "Page.handleJavaScriptDialog", "IO.close"].includes(method)) return {};
      if (method === "Runtime.evaluate") return { result: { value: "[1/2] [2/2]" } };
      if (method === "Page.printToPDF") return { stream: "stream-1" };
      if (method === "IO.read") return { data: Buffer.from("%PDF-test").toString("base64"), base64Encoded: true, eof: true };
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  try {
    const result = await captureShoplingLabelPdf(config({ dataDir: directory }), {
      expectedPages: 2,
      outputPath,
    }, {
      listChromeTargets: async () => ({
        available: true,
        targets: [{
          id: "label",
          url: "https://a.shopling.co.kr/order/dlvy_print/018_003_chrome.phtml",
          webSocketDebuggerUrl: "ws://label",
        }],
      }),
      withCdpTarget: async (_target, handler) => handler(session),
    });
    assert.equal(result.pageCount, 2);
    assert.equal(result.pdfBytes, 9);
    assert.equal((await readFile(outputPath, "utf8")), "%PDF-test");
    assert.equal(calls.find((call) => call.method === "Page.printToPDF").params.transferMode, "ReturnAsStream");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows label printer stays in dry-run unless execute is explicit", async () => {
  const base = {
    pdfPath: "C:/tmp/labels.pdf",
    expectedPages: 31,
    pdftoppm: "C:/tools/pdftoppm.exe",
  };
  assert.equal(buildWindowsPdfPrintArgs(base).includes("--execute"), false);
  assert.equal(buildWindowsPdfPrintArgs({ ...base, execute: true }).includes("--execute"), true);

  let invoked;
  const result = await runWindowsPdfPrint({
    pdfPath: base.pdfPath,
    expectedPages: 31,
    execute: false,
  }, {
    allowNonWindows: true,
    runtime: { python: "python.exe", pdftoppm: base.pdftoppm },
    execFile: async (executable, args) => {
      invoked = { executable, args };
      return { stdout: JSON.stringify({
        executed: false,
        printer: "Xprinter XP-DT108B LABEL",
        form: { name: "대한통운 송장", widthMm: 109, heightMm: 127 },
        pageCount: 31,
        printerCaps: { physicalWidthMm: 109.1, physicalHeightMm: 127 },
        jobId: null,
      }) };
    },
  });
  assert.equal(invoked.executable, "python.exe");
  assert.equal(invoked.args.includes("--execute"), false);
  assert.equal(result.pageCount, 31);
});

test("Windows label printer rejects mismatched output and missing spool job ids", () => {
  const valid = {
    executed: true,
    printer: "Xprinter XP-DT108B LABEL",
    form: { name: "대한통운 송장", widthMm: 109, heightMm: 127 },
    pageCount: 14,
    printerCaps: { physicalWidthMm: 109.1, physicalHeightMm: 127 },
    jobId: 42,
  };
  assert.equal(validateWindowsPdfPrintResult(valid, { expectedPages: 14, execute: true }).jobId, 42);
  assert.throws(
    () => validateWindowsPdfPrintResult({ ...valid, pageCount: 13 }, { expectedPages: 14, execute: true }),
    { code: "LABEL_PRINT_PAGE_COUNT_INVALID" },
  );
  assert.throws(
    () => validateWindowsPdfPrintResult({ ...valid, jobId: null }, { expectedPages: 14, execute: true }),
    { code: "LABEL_PRINT_JOB_ID_INVALID" },
  );
});

test("standalone Shopling label HTML removes active scripts and the loading overlay", () => {
  const html = '<div id="loading"><img src="loading.gif"></div><script>alert(1)</script><div class="page"><img src="barcode.png"></div>';
  const standalone = buildStandaloneLabelHtml(html, new Map([["barcode.png", "assets/barcode.png"]]));
  assert.match(standalone, /@page \{ size: 109mm 127mm; margin: 0 11pt; \}/);
  assert.match(standalone, /break-after: page/);
  assert.match(standalone, /assets\/barcode\.png/);
  assert.doesNotMatch(standalone, /id="loading"/);
  assert.doesNotMatch(standalone, /<script/);
});

test("Shopling label HTML can strictly auto-detect its page count", () => {
  const html = '<div class="page">[1/2]</div><div class="page">[2 / 2]</div>';
  assert.equal(validateShoplingLabelHtmlPageCount(html, { autoDetectPages: true }), 2);
  assert.equal(validateShoplingLabelHtmlPageCount(html, { expectedPages: 2 }), 2);
  assert.throws(
    () => validateShoplingLabelHtmlPageCount(html, { expectedPages: 3 }),
    { code: "SHOPLING_LABEL_HTML_PAGE_COUNT_MISMATCH" },
  );
});
