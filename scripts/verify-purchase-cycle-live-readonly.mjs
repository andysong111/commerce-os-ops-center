import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const ORIGIN = "https://commerce-os-ops-center.vercel.app";
const REPOSITORY = "andysong111/commerce-os-ops-center";
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const STAGES = ["order", "receipt", "master", "inventory", "sale", "cost", "funding", "next"];
const STATES = ["BLOCKED", "NEEDS_ACTION", "READY_FOR_NEXT_CALCULATION", "NO_ORDER_CLOSED"];
const ACTIONS = ["RECHECK", "OPEN_WORKSPACE", "RETRY_RECEIPT_FOLLOWUP", "REFRESH_STOCK_EVIDENCE", "OPEN_STOCK_CONTROL", "OPEN_PRICE_REVIEW", "OPEN_NEXT_CALCULATION"];
const requireProof = (condition, code) => { if (!condition) throw new Error(code); };

export function safeCycleSummary(status, body, month) {
  requireProof(MONTH.test(month), "LIVE_MONTH_INVALID");
  requireProof(status === 200, `LIVE_HTTP_${Number.isInteger(status) ? status : "INVALID"}`);
  const report = body?.report;
  requireProof(body?.ok === true && report && report.cycleMonth === month && report.actualPurchaseExecuted === false, "LIVE_REPORT_INVALID");
  requireProof(STATES.includes(report.state) && ACTIONS.includes(report.nextAction), "LIVE_STATE_INVALID");
  requireProof(Array.isArray(report.stages) && report.stages.length === STAGES.length, "LIVE_STAGES_INVALID");
  const stages = {};
  for (const id of STAGES) {
    const matches = report.stages.filter((stage) => stage?.id === id);
    requireProof(matches.length === 1 && ["VERIFIED", "PENDING", "NOT_STARTED"].includes(matches[0].state), "LIVE_STAGES_INVALID");
    stages[id] = matches[0].state;
  }
  requireProof(Array.isArray(report.followups) && Array.isArray(report.warnings), "LIVE_EVIDENCE_INVALID");
  for (const value of [report.receivedQuantity, report.openQuantity, report.verifiedReceiptCount, report.pendingReceiptCount, report.missingBaselineCount]) {
    requireProof(Number.isSafeInteger(value) && value >= 0, "LIVE_COUNTS_INVALID");
  }
  requireProof(report.followups.every((row) => ["VERIFIED", "PENDING"].includes(row?.state)), "LIVE_FOLLOWUPS_INVALID");
  requireProof(report.verifiedReceiptCount === report.followups.filter((row) => row.state === "VERIFIED").length && report.pendingReceiptCount === report.followups.filter((row) => row.state !== "VERIFIED").length, "LIVE_FOLLOWUPS_INVALID");
  if (report.state === "READY_FOR_NEXT_CALCULATION") {
    // A missing stockout baseline is an allowed accumulation state: that SKU stays
    // off the exact-inventory path until a real SOLD_OUT_RESET=0 is observed.
    // Readiness still requires every existing exact baseline and sale-status obligation to be VERIFIED.
    requireProof(STAGES.filter((id) => id !== "next").every((id) => stages[id] === "VERIFIED") && stages.next === "NOT_STARTED" && report.nextAction === "OPEN_NEXT_CALCULATION" && report.receivedQuantity > 0 && report.openQuantity === 0 && report.pendingReceiptCount === 0 && report.warnings.length === 0 && report.followups.length > 0, "LIVE_FALSE_COMPLETION");
    const receiptIds = new Set();
    let evidencedQuantity = 0;
    for (const row of report.followups) {
      requireProof(typeof row.receiptId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.receiptId) && !receiptIds.has(row.receiptId), "LIVE_RECEIPT_EVIDENCE_INVALID");
      requireProof(typeof row.draftId === "string" && /^fast-purchase-draft:[a-f0-9]{20}$/.test(row.draftId) && row.cycleMonth === month && row.state === "VERIFIED" && row.canRetry === false && row.errorCode === null, "LIVE_RECEIPT_EVIDENCE_INVALID");
      requireProof(Number.isSafeInteger(row.lineCount) && row.lineCount > 0 && row.lineCount <= 100 && Array.isArray(row.barcodes) && row.barcodes.length === row.lineCount && new Set(row.barcodes).size === row.lineCount && row.barcodes.every((code) => typeof code === "string" && /^B[A-Z]{1,2}\d+-\d+$/.test(code)), "LIVE_RECEIPT_EVIDENCE_INVALID");
      requireProof(Number.isSafeInteger(row.receivedQuantity) && row.receivedQuantity >= row.lineCount && typeof row.fingerprint === "string" && /^sha256:[a-f0-9]{64}$/.test(row.fingerprint) && typeof row.verifiedAt === "string" && Number.isFinite(Date.parse(row.verifiedAt)), "LIVE_RECEIPT_EVIDENCE_INVALID");
      receiptIds.add(row.receiptId); evidencedQuantity += row.receivedQuantity;
      requireProof(Number.isSafeInteger(evidencedQuantity), "LIVE_RECEIPT_EVIDENCE_INVALID");
    }
    requireProof(evidencedQuantity === report.receivedQuantity, "LIVE_RECEIPT_EVIDENCE_INVALID");
  }
  if (report.state === "NO_ORDER_CLOSED") {
    requireProof(report.nextAction === "OPEN_NEXT_CALCULATION" && report.missingBaselineCount === 0 && report.receivedQuantity === 0 && report.openQuantity === 0 && report.followups.length === 0 && report.warnings.length === 0 && stages.order === "VERIFIED" && STAGES.filter((id) => id !== "order").every((id) => stages[id] === "NOT_STARTED"), "LIVE_FALSE_NO_ORDER");
  }
  // Public CI logs receive enums/booleans only: never receipt IDs, B codes,
  // quantities, costs, customer details, arbitrary messages or raw responses.
  return {
    month, readbackVerified: true, cycleState: report.state, nextAction: report.nextAction, stages,
    businessCycleReady: report.state === "READY_FOR_NEXT_CALCULATION",
    hasPendingReceipts: report.pendingReceiptCount > 0,
    hasMissingInventoryBaseline: report.missingBaselineCount > 0,
    baselineAccumulationInProgress: report.missingBaselineCount > 0,
    hasWarnings: report.warnings.length > 0,
    actualPurchaseExecuted: false,
  };
}

export function allowedLiveRequest(url, method) {
  if (!["GET", "HEAD"].includes(method)) return false;
  let target;
  try { target = new URL(url); } catch { return false; }
  if (target.origin !== ORIGIN || target.username || target.password || target.hash) return false;
  if (target.pathname === "/shopling-stock-state-sync/README.txt") return !target.search;
  return target.pathname === "/api/china-order-manager/cycle-status" && [...target.searchParams.keys()].length === 1 && MONTH.test(target.searchParams.get("month") || "");
}

export async function waitForProduction(sha, token, fetcher = fetch, pause = sleep) {
  requireProof(/^[a-f0-9]{40}$/.test(sha || "") && typeof token === "string" && token.length > 0, "LIVE_DEPLOYMENT_CONTEXT_REQUIRED");
  for (let attempt = 0; attempt < 24; attempt++) {
    // The token is used only against this fixed GitHub read endpoint, never
    // passed to a browser, printed or sent to the application.
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/commits/${sha}/status`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    requireProof(response.ok, "LIVE_DEPLOYMENT_READ_FAILED");
    const payload = await response.json();
    const deployment = payload.statuses?.find((row) => row.context === "Vercel");
    requireProof(!["error", "failure"].includes(deployment?.state), "LIVE_DEPLOYMENT_FAILED");
    if (deployment?.state === "success") {
      const head = await fetcher(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      requireProof(head.ok && (await head.json()).object?.sha === sha, "LIVE_DEPLOYMENT_SUPERSEDED");
      return;
    }
    await pause(10_000);
  }
  throw new Error("LIVE_DEPLOYMENT_WAIT_TIMEOUT");
}

function monthsToCheck() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  return [new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7), new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 7)];
}

async function main() {
  requireProof(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === "refs/heads/main" && ["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME), "LIVE_MAIN_ONLY");
  const sha = process.env.GITHUB_SHA;
  await waitForProduction(sha, process.env.GH_READ_TOKEN);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const summaries = [];
  let deniedRequests = 0;
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      if (!allowedLiveRequest(route.request().url(), route.request().method())) {
        deniedRequests++; await route.abort(); return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    // Use the existing inert text resource, not a Next 404 shell that mounts
    // application workers. A changed/missing bootstrap fails closed.
    const bootstrap = await page.goto(`${ORIGIN}/shopling-stock-state-sync/README.txt`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    requireProof(bootstrap && bootstrap.status() === 200 && /^text\/plain\b/i.test(bootstrap.headers()["content-type"] || "") && new URL(page.url()).origin === ORIGIN, "LIVE_BROWSER_ORIGIN_UNAVAILABLE");
    // A real browser performs normal same-origin reads. No fabricated auth
    // header, login override, credential injection, POST or UI click is used.
    for (const month of monthsToCheck()) {
      const result = await page.evaluate(async (path) => {
        const response = await fetch(path, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(185_000) });
        return { status: response.status, body: await response.json().catch(() => null) };
      }, `/api/china-order-manager/cycle-status?month=${month}`);
      summaries.push(safeCycleSummary(result.status, result.body, month));
    }
    requireProof(deniedRequests === 0, "LIVE_UNEXPECTED_REQUEST_BLOCKED");
    await waitForProduction(sha, process.env.GH_READ_TOKEN);
    const output = { checkedCommit: sha, generatedAt: new Date().toISOString(), browserWriteRequestsSent: 0, results: summaries };
    await mkdir("artifacts/purchase-cycle-live", { recursive: true });
    await writeFile("artifacts/purchase-cycle-live/summary.json", JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Raw error text can contain response content or URLs. Never log it.
    const code = /^LIVE_[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "LIVE_READBACK_FAILED";
    console.error(code); process.exitCode = 1;
  });
}
