import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf23Download } from "../download-hf23/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED";
const BACKGROUND_OLD = "background-v064.js";
const BACKGROUND_NEW = "background-v065.js";
const RESULT_CONTENT_OLD = "content-stock-status-result-v023.js";
const CONTENT_OPS = "content-ops-v021.js";
const RESULT_MATCHES = ["http://*.shopling.co.kr/*", "https://*.shopling.co.kr/*"];

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf23Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf24_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF24", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF24", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF24", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF24", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF24", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF23", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF24", "status"],
    ['stockSyncChannel: "HF23"', 'stockSyncChannel: "HF24"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf24_${code}`);
  new Function(ops);
  entries[CONTENT_OPS] = strToU8(ops);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    permissions?: string[];
    host_permissions?: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{
      matches: string[];
      exclude_matches?: string[];
      js: string[];
      all_frames?: boolean;
      run_at?: string;
      world?: string;
    }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf24_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf24_hf23_checkpoint_missing");

  manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of ["tabs", "windows", "scripting", "webNavigation"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }
  manifest.host_permissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const match of RESULT_MATCHES) {
    if (!manifest.host_permissions.includes(match)) manifest.host_permissions.push(match);
  }

  // HF24 intentionally removes the cross-host result content script. The background
  // service worker probes the exact result document directly, so there is no page->extension
  // message dependency left in the completion path.
  manifest.content_scripts = manifest.content_scripts.filter((script) => !script.js?.includes(RESULT_CONTENT_OLD));

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF24";
  manifest.description = "HF24 directly scans the real aapi*.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml result from the background service worker with chrome.scripting.executeScript, so completion no longer depends on a result-page content-script message. After the exact terminal footer is stable for 2.5s it ACKs first and copies the price-adjustment completeJob->closeManaged window-removal order. A6 max pagination, A21 200-row batching and HF10 OPTION remain unchanged.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF24`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v059.js")',
    "chrome.scripting.executeScript",
    "/\\/prod_a\\/prod_status_trsmt\\.phtml$/i",
    "상품\\s*상태\\s*변경\\s*전송이\\s*완료되었습니다",
    "STABLE_MS_V065 = 2_500",
    "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED",
    "continueNextGoodsKey(",
    "closeManagedPriceStyleV065",
    "chrome.windows.remove(windowId)",
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf24_background_guard_missing:${guard}`);
  }
  if (background.includes('importScripts("background-v060.js")') || background.includes('importScripts("background-v061.js")') || background.includes('importScripts("background-v062.js")') || background.includes('importScripts("background-v063.js")') || background.includes('importScripts("background-v064.js")')) {
    throw new Error("shopling_stock_hf24_prior_single_result_watcher_imported");
  }
  if (manifest.content_scripts.some((script) => script.js?.includes(RESULT_CONTENT_OLD))) {
    throw new Error("shopling_stock_hf24_result_content_dependency_still_present");
  }
  if (ops.includes("_HF23")) throw new Error("shopling_stock_hf24_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF24";')) throw new Error("shopling_stock_hf24_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF24"')) throw new Error("shopling_stock_hf24_channel_marker_missing");
  for (const match of RESULT_MATCHES) {
    if (!manifest.host_permissions.includes(match)) throw new Error(`shopling_stock_hf24_host_permission_missing:${match}`);
  }

  for (const required of [
    "background-v055.js",
    "background-v058.js",
    "background-v059.js",
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf24_checkpoint_missing:${required}`);
  }

  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf24_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF24_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      optionFlow: "HF10_UNCHANGED",
      observedLiveResult: "aapi10.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml",
      resultHostPermissions: RESULT_MATCHES,
      singleResultAuthority: "BACKGROUND_EXACT_RESULT_TAB_SCANNER",
      resultContentScriptDependency: false,
      previousSingleResultWatchersImported: false,
      directProbe: "chrome.scripting.executeScript(allFrames)",
      directCompletionFooter: "상품상태 변경 전송이 완료되었습니다.",
      completionStabilityMs: 2500,
      closeReference: "shopling-a21-price-option-resend background-v020 completeJob -> closeManaged",
      closePolicy: "ACK_THEN_REMOVE_RESULT_AND_REMEMBERED_POPUP_WINDOWS",
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf24.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF24_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
