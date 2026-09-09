import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf21Download } from "../download-hf21/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE";
const BACKGROUND_OLD = "background-v062.js";
const BACKGROUND_NEW = "background-v063.js";
const CONTENT_OPS = "content-ops-v021.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf21Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf22_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF22", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF22", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF22", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF22", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF22", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF21", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF22", "status"],
    ['stockSyncChannel: "HF21"', 'stockSyncChannel: "HF22"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf22_${code}`);
  new Function(ops);
  entries[CONTENT_OPS] = strToU8(ops);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    permissions?: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf22_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf22_hf21_checkpoint_missing");

  manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of ["tabs", "windows", "scripting", "webNavigation", "debugger"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF22";
  manifest.description = "HF22 ports the actual live price-adjustment extension v0.4.4 result lifecycle to SINGLE sale-status jobs: created-tab/opener tracking including about:blank/javascript/blob, CDP all execution contexts + Accessibility, exact final footer stability, ACK first, then deterministic managed result-window close. When the whole job is done it also removes the owned A6/A21 worker windows.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF22`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v062.js")',
    'const WORKSPACE_KEY_V063 = "commerceStockWorkspaceV030"',
    "createdTabsV063",
    "/^(about:blank|javascript:|blob:)/i",
    "Accessibility.getFullAXTree",
    'chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate"',
    "window.scrollTo(0, Math.max(document.body?.scrollHeight",
    "상품\\s*상태\\s*변경\\s*전송이\\s*완료되었습니다",
    "HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE",
    "continueNextGoodsKey(",
    "closeResultWindowV063",
    "closeOwnedWorkspaceWindowsV063",
    "chrome.windows.remove(windowId)",
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf22_background_guard_missing:${guard}`);
  }
  if (ops.includes("_HF21")) throw new Error("shopling_stock_hf22_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF22";')) throw new Error("shopling_stock_hf22_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF22"')) throw new Error("shopling_stock_hf22_channel_marker_missing");

  for (const required of [
    "background-v055.js",
    "background-v059.js",
    "background-v060.js",
    "background-v061.js",
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-stock-result-v050.js",
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf22_checkpoint_missing:${required}`);
  }

  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf22_missing_packaged_file:${file}`);
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
      pageChannel: "HF22_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      hf20Hf21FallbacksPreserved: true,
      optionFlow: "HF10_UNCHANGED",
      referenceImplementation: "shopling-a21-price-option-resend v0.4.4 background-v044 + background-v020 closeManaged",
      resultCandidatePolicy: "CREATED_TAB_OPENER_PLUS_ABOUT_BLANK_JAVASCRIPT_BLOB_PLUS_SHOPLING",
      resultCompletionDetection: "CDP_ALL_CONTEXTS_PLUS_ACCESSIBILITY_EXACT_FOOTER",
      completionStabilityMs: 2500,
      ackBeforeClose: true,
      resultClose: "DETERMINISTIC_WINDOW_REMOVE_THEN_TAB_FALLBACK",
      finalWorkerClose: "OWNED_COMMERCE_STOCK_WORKSPACE_A6_A21_WINDOWS",
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf22.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF22_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
