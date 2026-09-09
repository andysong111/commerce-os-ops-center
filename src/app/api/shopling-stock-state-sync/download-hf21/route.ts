import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf20Download } from "../download-hf20/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF21_EXACT_PRODUCT_STATE_CHANGE_FOOTER_SCROLL_AUTOCLOSE";
const BACKGROUND_OLD = "background-v061.js";
const BACKGROUND_NEW = "background-v062.js";
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
  const baseResponse = await getHf20Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf21_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF21", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF21", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF21", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF21", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF21", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF20", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF21", "status"],
    ['stockSyncChannel: "HF20"', 'stockSyncChannel: "HF21"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf21_${code}`);
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
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf21_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf21_hf20_checkpoint_missing");

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF21";
  manifest.description = "HF21 preserves HF20/HF19 flow, but for SINGLE sale-status results it programmatically scrolls every accessible Shopling result frame to the bottom and requires the exact terminal footer '상품상태 변경 전송이 완료되었습니다.' in that same non-processing frame. After 1.8s stability it ACKs success first and closes that result window/tab.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF21`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v061.js")',
    "상품상태 변경 전송이 완료되었습니다.",
    "window.scrollTo(0, bottom)",
    "element.scrollTop = element.scrollHeight",
    "row.exactFooter && !row.processing && row.readyState === \"complete\"",
    "HF21_EXACT_PRODUCT_STATE_CHANGE_FOOTER_SCROLL_AUTOCLOSE",
    "continueNextGoodsKey(",
    "chrome.windows.remove(tab.windowId)",
    "chrome.tabs.remove(tabId)",
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf21_background_guard_missing:${guard}`);
  }
  if (ops.includes("_HF20")) throw new Error("shopling_stock_hf21_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF21";')) throw new Error("shopling_stock_hf21_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF21"')) throw new Error("shopling_stock_hf21_channel_marker_missing");

  for (const required of [
    "background-v055.js",
    "background-v059.js",
    "background-v060.js",
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-stock-result-v050.js",
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf21_checkpoint_missing:${required}`);
  }

  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf21_missing_packaged_file:${file}`);
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
      pageChannel: "HF21_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      hf20CdpAxWatcherPreserved: true,
      optionFlow: "HF10_UNCHANGED",
      singleCompletionPrimary: "EXACT_FOOTER_상품상태_변경_전송이_완료되었습니다",
      singleProbe: "SCROLL_EVERY_ACCESSIBLE_FRAME_AND_SCROLL_CONTAINER_WITH_SCRIPTING",
      processingGuard: "SAME_FRAME_ONLY",
      completionStabilityMs: 1800,
      ackBeforeClose: true,
      managedClose: "WINDOW_REMOVE_IF_DEDICATED_ELSE_TAB_REMOVE",
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf21.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF21_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
