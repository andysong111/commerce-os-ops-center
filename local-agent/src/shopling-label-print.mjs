import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { listChromeTargets, withBrowserCdpTarget } from "./chrome-cdp.mjs";

export const SHOPLING_LABEL_PATH = "/order/dlvy_print/018_003_chrome.phtml";
export const SHOPLING_LABEL_WIDTH_MM = 109;
export const SHOPLING_LABEL_HEIGHT_MM = 127;
export const SHOPLING_LABEL_SIDE_MARGIN_POINTS = 11;

function mmToInches(value) {
  return value / 25.4;
}

export function buildShoplingLabelPdfOptions() {
  return {
    landscape: false,
    displayHeaderFooter: false,
    printBackground: false,
    scale: 1,
    paperWidth: mmToInches(SHOPLING_LABEL_WIDTH_MM),
    paperHeight: mmToInches(SHOPLING_LABEL_HEIGHT_MM),
    marginTop: 0,
    marginBottom: 0,
    marginLeft: SHOPLING_LABEL_SIDE_MARGIN_POINTS / 72,
    marginRight: SHOPLING_LABEL_SIDE_MARGIN_POINTS / 72,
    preferCSSPageSize: false,
    transferMode: "ReturnAsStream",
  };
}

export function extractLabelPageCount(nodes = []) {
  let pageCount = 0;
  for (const node of nodes) {
    const values = [node?.name?.value, node?.value?.value];
    for (const value of values) {
      for (const match of String(value || "").matchAll(/\[(\d+)\s*\/\s*(\d+)\]/g)) {
        pageCount = Math.max(pageCount, Number(match[2]) || 0);
      }
    }
  }
  return pageCount;
}

export function selectShoplingLabelTarget(targets = []) {
  const matches = targets.filter((target) => {
    try {
      return new URL(target.url).pathname === SHOPLING_LABEL_PATH;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    const error = new Error(`Expected one Shopling label document, found ${matches.length}.`);
    error.code = "SHOPLING_LABEL_TARGET_COUNT_INVALID";
    throw error;
  }
  return matches[0];
}

async function readCdpStream(session, handle, timeoutMs) {
  const chunks = [];
  try {
    for (;;) {
      const chunk = await session.send("IO.read", { handle, size: 1_048_576 }, timeoutMs);
      if (chunk.data) chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      if (chunk.eof) break;
    }
  } finally {
    await session.send("IO.close", { handle }, timeoutMs).catch(() => null);
  }
  return Buffer.concat(chunks);
}

export async function waitForLabelPages(session, expectedPages, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const commandTimeoutMs = options.commandTimeoutMs || 8_000;
  const pollIntervalMs = options.pollIntervalMs || 1_000;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const deadline = now() + timeoutMs;
  let lastPageCount = 0;
  let lastError = null;

  while (now() < deadline) {
    try {
      const evaluated = await session.send("Runtime.evaluate", {
        expression: "document.body ? document.body.innerText : ''",
        returnByValue: true,
      }, commandTimeoutMs);
      lastPageCount = extractLabelPageCount([{ value: { value: evaluated.result?.value || "" } }]);
      if (!lastPageCount) {
        const tree = await session.send("Accessibility.getFullAXTree", {}, commandTimeoutMs);
        lastPageCount = extractLabelPageCount(tree.nodes || []);
      }
      if (lastPageCount === expectedPages) return lastPageCount;
      if (lastPageCount > expectedPages) {
        const error = new Error(`Label document has ${lastPageCount} pages; expected ${expectedPages}.`);
        error.code = "SHOPLING_LABEL_PAGE_COUNT_MISMATCH";
        throw error;
      }
    } catch (error) {
      if (error.code === "SHOPLING_LABEL_PAGE_COUNT_MISMATCH") throw error;
      lastError = error;
    }
    await sleep(pollIntervalMs);
  }

  const error = new Error(`Label document did not reach ${expectedPages} pages before timeout (last count: ${lastPageCount}).`);
  error.code = "SHOPLING_LABEL_RENDER_TIMEOUT";
  error.cause = lastError;
  throw error;
}

export async function captureShoplingLabelPdf(config, options = {}, dependencies = {}) {
  const expectedPages = Number(options.expectedPages);
  if (!Number.isInteger(expectedPages) || expectedPages <= 0) {
    const error = new Error("A positive expected label page count is required.");
    error.code = "SHOPLING_LABEL_EXPECTED_PAGES_REQUIRED";
    throw error;
  }

  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const runWithTarget = dependencies.withCdpTarget
    || ((selectedTarget, handler, targetOptions) => withBrowserCdpTarget(config, selectedTarget, handler, targetOptions));
  const listing = await listTargets(config);
  if (!listing.available) {
    const error = new Error("Chrome DevTools is unavailable.");
    error.code = "CHROME_CDP_UNAVAILABLE";
    error.cause = listing.error;
    throw error;
  }
  const target = selectShoplingLabelTarget(listing.targets);
  const outputPath = resolve(options.outputPath || resolve(config.dataDir, "labels", "shopling-labels.pdf"));
  const commandTimeoutMs = options.commandTimeoutMs || 60_000;

  const result = await runWithTarget(target, async (session) => {
    await session.send("Page.handleJavaScriptDialog", { accept: true }, 5_000).catch(() => null);
    const pageCount = options.skipDomPageCheck
      ? expectedPages
      : await waitForLabelPages(session, expectedPages, {
        timeoutMs: options.renderTimeoutMs,
        commandTimeoutMs: Math.min(commandTimeoutMs, 8_000),
        pollIntervalMs: options.pollIntervalMs,
      });
    const pdf = await session.send("Page.printToPDF", buildShoplingLabelPdfOptions(), commandTimeoutMs);
    const bytes = pdf.stream
      ? await readCdpStream(session, pdf.stream, commandTimeoutMs)
      : Buffer.from(pdf.data || "", "base64");
    if (!bytes.length || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      const error = new Error("Chrome did not return a valid PDF document.");
      error.code = "SHOPLING_LABEL_PDF_INVALID";
      throw error;
    }
    return { bytes, pageCount };
  }, { timeoutMs: commandTimeoutMs });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.bytes);
  return {
    outputPath,
    pageCount: result.pageCount,
    pdfBytes: result.bytes.length,
    printerProfile: {
      widthMm: SHOPLING_LABEL_WIDTH_MM,
      heightMm: SHOPLING_LABEL_HEIGHT_MM,
      sideMarginPoints: SHOPLING_LABEL_SIDE_MARGIN_POINTS,
    },
    pageCountValidation: options.skipDomPageCheck ? "pdf-parser" : "dom-and-pdf-parser",
  };
}
