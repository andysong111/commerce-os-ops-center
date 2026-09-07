import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { buildStockWorkerV030 } from "../../../../../scripts/build-shopling-stock-worker-v030.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const VERSION = "0.5.1";
const FILES = [
  "manifest.json",
  "background-v020.js",
  "background-v030.js",
  "background-v040.js",
  "background-v050.js",
  "content-ops-v021.js",
  "content-stock-result-v050.js",
  "main-shopling.js",
  "popup.html",
  "popup.js",
  "README.txt",
];

function namespacePriceCoreContent(source: string) {
  const namespaced = source
    .replace('const VERSION = "0.2.4";', 'const VERSION = chrome.runtime.getManifest().version;')
    .replaceAll("A21_POPUP_CLAIM_V020", "STOCK_PRICE_CORE_POPUP_CLAIM_V050")
    .replaceAll("commerce-os-a21-v024-main-submit-request", "commerce-os-stock-price-core-v050-main-submit-request")
    .replaceAll("commerce-os-a21-v024-main-submit-response", "commerce-os-stock-price-core-v050-main-submit-response")
    .replaceAll("commerce-os-a21-v024-status", "commerce-os-stock-price-core-v050-status")
    .replace('node.textContent = "Commerce OS v0.2.4 · 송신 작업 연결 대기";', 'node.textContent = `Stock Sync PriceCore v${VERSION} · 송신 작업 연결 대기`;')
    .replace('node.textContent = `Commerce OS v0.2.4 · ${text}`;', 'node.textContent = `Stock Sync PriceCore v${VERSION} · ${text}`;')
    .replaceAll('type: "A21_JOB_FAILURE"', 'type: "STOCK_PRICE_CORE_FAILURE_V050"')
    .replaceAll('type: "A21_STAGE"', 'type: "STOCK_PRICE_CORE_STAGE_V050"');

  const originalClaim = `  async function claim() {
    if (!isExactPopupUrl()) return;
    status("송신 작업 assignment 요청 중");
    const response = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: "A21_POPUP", href: location.href, version: VERSION }).catch(() => null);
    if (!response?.ok || !response.assignment?.jobId) {
      status(\`assignment 대기 · \${response?.error || "응답 없음"}\`, "warn");
      return;
    }
    return configureAndSubmit(response.assignment);
  }`;
  if (!namespaced.includes("  let busy = false;") || !namespaced.includes(originalClaim)) {
    throw new Error("shopling_stock_price_core_claim_adapter_source_mismatch");
  }

  const retryingClaim = `  async function claim() {
    if (!isExactPopupUrl() || claimInFlight || busy) return;
    claimInFlight = true;
    try {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        status(attempt === 0 ? "송신 작업 assignment 요청 중" : \`assignment 상태전환 재시도 \${attempt}/15\`);
        const response = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: "A21_POPUP", href: location.href, version: VERSION }).catch(() => null);
        if (response?.ok && response.assignment?.jobId) {
          return await configureAndSubmit(response.assignment);
        }
        const error = response?.error || "응답 없음";
        status(\`assignment 대기 · \${error}\`, "warn");
        if (error !== "stock_price_core_not_option_popup_stage") return;
        await sleep(250);
      }
      status("assignment 대기 · A21 상태전환 시간초과", "warn");
    } finally {
      claimInFlight = false;
    }
  }`;

  const adapted = namespaced
    .replace("  let busy = false;", "  let busy = false;\n  let claimInFlight = false;")
    .replace(originalClaim, retryingClaim);
  if (
    !adapted.includes("let claimInFlight = false") ||
    !adapted.includes("attempt < 16") ||
    !adapted.includes('error !== "stock_price_core_not_option_popup_stage"')
  ) {
    throw new Error("shopling_stock_price_core_claim_retry_adapter_missing");
  }
  return adapted;
}

function namespacePriceCoreMain(source: string) {
  return source
    .replace('const VERSION = "0.2.4";', `const VERSION = "${VERSION}";`)
    .replaceAll("commerce-os-a21-v024-main-submit-request", "commerce-os-stock-price-core-v050-main-submit-request")
    .replaceAll("commerce-os-a21-v024-main-submit-response", "commerce-os-stock-price-core-v050-main-submit-response");
}

export async function GET(request: Request) {
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const canonicalRoot = path.join(process.cwd(), "public", "shopling-a21-price-option-resend");
  const entries: Record<string, Uint8Array> = {};
  for (const name of FILES) {
    const source = await readFile(path.join(root, name), "utf8");
    if (name.endsWith(".js")) new Function(source);
    entries[name] = strToU8(source);
  }

  const canonicalPriceContent = await readFile(path.join(canonicalRoot, "content-a21-v024.js"), "utf8");
  const canonicalPriceMain = await readFile(path.join(canonicalRoot, "main-a21-v024.js"), "utf8");
  const copiedPriceContent = await readFile(path.join(root, "price-core-content-a21-v024.js"), "utf8");
  const copiedPriceMain = await readFile(path.join(root, "price-core-main-a21-v024.js"), "utf8");
  if (copiedPriceContent !== canonicalPriceContent || copiedPriceMain !== canonicalPriceMain) {
    throw new Error("shopling_stock_price_core_copy_must_match_canonical_v024");
  }
  const priceCoreContent = namespacePriceCoreContent(copiedPriceContent);
  const priceCoreMain = namespacePriceCoreMain(copiedPriceMain);
  new Function(priceCoreContent);
  new Function(priceCoreMain);
  entries["content-a21-price-core-v050.js"] = strToU8(priceCoreContent);
  entries["main-a21-price-core-v050.js"] = strToU8(priceCoreMain);

  const template = await readFile(path.join(root, "content-shopling-v018.js"), "utf8");
  const policy = await readFile(path.join(root, "search-policy-v023.js"), "utf8");
  const builtWorker = buildStockWorkerV030(template, policy);
  if (!builtWorker.includes('const VERSION = "0.4.2";')) {
    throw new Error("shopling_stock_state_list_worker_version_template_mismatch");
  }
  const worker = builtWorker
    .replace('const VERSION = "0.4.2";', 'const VERSION = "0.5.1";')
    .replaceAll("__commerceStockWorkerV042", "__commerceStockWorkerV050");
  new Function(worker);
  entries["content-shopling-v030.js"] = strToU8(worker);

  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
    manifest_version: number;
    version: string;
    permissions: string[];
    host_permissions: string[];
    background: { service_worker: string };
    action: { default_popup: string };
    content_scripts: Array<{
      js: string[];
      matches: string[];
      exclude_matches?: string[];
      world?: string;
      all_frames?: boolean;
    }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_state_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v050.js") {
    throw new Error("shopling_stock_state_background_v050_required");
  }
  for (const permission of ["storage", "tabs", "windows", "scripting", "webNavigation", "alarms"]) {
    if (!manifest.permissions.includes(permission)) throw new Error(`shopling_stock_state_permission_missing:${permission}`);
  }
  for (const host of ["https://a.shopling.co.kr/*", "https://commerce-os-ops-center.vercel.app/*"]) {
    if (!manifest.host_permissions.includes(host)) throw new Error("shopling_stock_state_host_permissions_missing");
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_state_missing_packaged_file:${file}`);
  }

  const listWorker = manifest.content_scripts.find((script) => script.js.includes("content-shopling-v030.js"));
  const popupWorker = manifest.content_scripts.find((script) => script.js.includes("content-a21-price-core-v050.js"));
  const popupMain = manifest.content_scripts.find((script) => script.js.includes("main-a21-price-core-v050.js"));
  const resultObserver = manifest.content_scripts.find((script) => script.js.includes("content-stock-result-v050.js"));
  if (!listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml"))) {
    throw new Error("shopling_stock_state_popup_must_be_excluded_from_list_worker");
  }
  if (!popupWorker?.matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml"))) {
    throw new Error("shopling_stock_state_price_core_popup_worker_required");
  }
  if (popupMain?.world !== "MAIN" || !popupMain.matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml"))) {
    throw new Error("shopling_stock_state_price_core_main_world_required");
  }
  if (!resultObserver?.all_frames) {
    throw new Error("shopling_stock_state_result_observer_all_frames_required");
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const popupWorkerSha256 = createHash("sha256").update(priceCoreContent).digest("hex");
  const popupMainSha256 = createHash("sha256").update(priceCoreMain).digest("hex");
  const canonicalPriceContentSha256 = createHash("sha256").update(canonicalPriceContent).digest("hex");
  const canonicalPriceMainSha256 = createHash("sha256").update(canonicalPriceMain).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        files: Object.keys(entries),
        zipBytes: zip.byteLength,
        workerSha256,
        popupWorkerSha256,
        popupMainSha256,
        canonicalPriceContentSha256,
        canonicalPriceMainSha256,
        priceCoreLiteralCopyVerified: true,
        priceCoreCanonical: ["shopling-a21-price-option-resend/content-a21-v024.js", "shopling-a21-price-option-resend/main-a21-v024.js"],
        searchStart: "2024-01-01",
        mode: "SHOPLING_API_OPTION_STATUS_THEN_A21_LITERAL_PRICE_CORE_V051_CLAIM_RACE_RETRY",
        optionLocalMutation: "SERVER_API_GUARDED",
        a21SearchBinding: "ROW_SCOPED_VERIFIED",
        a21SearchSubmitGuard: "ONE_CLICK_TICKET",
        a21ResultSelection: "EXACT_GOODS_KEY_ALL_ROWS_UP_TO_200",
        a21BatchLimit: 200,
        a21PopupAssignment: "PRICE_CORE_SELF_CLAIM_ADAPTER_WITH_STAGE_RACE_RETRY",
        a21PopupClaimRetry: { intervalMs: 250, attempts: 16, onlyError: "stock_price_core_not_option_popup_stage" },
        a21PopupConfiguration: "CANONICAL_PRICE_CORE_MODIFY_TP_GOODS_STOCK_AND_TRSMT_ENV_MODY_OPT_1",
        a21PopupSubmit: "CANONICAL_PRICE_CORE_MAIN_WORLD_GOODS_MALLMDFY_SUBMIT_SP",
        resultEvidence: "PASSIVE_ALL_FRAME_OBSERVER",
        optionBrowserStages: ["A21_LIST", "A21_POPUP"],
        singleBrowserStages: ["A4", "A21_LIST", "A21_POPUP"],
        liveShoplingVerified: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-worker-sha256": workerSha256,
      "x-stock-popup-worker-sha256": popupWorkerSha256,
      "x-stock-popup-main-sha256": popupMainSha256,
    },
  });
}
