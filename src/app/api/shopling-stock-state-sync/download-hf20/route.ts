import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf19Download } from "../download-hf19/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF20_SINGLE_PRICE_V044_STYLE_CDP_AX_PROACTIVE_AUTOCLOSE";
const BACKGROUND_OLD = "background-v060.js";
const BACKGROUND_NEW = "background-v061.js";
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
  const baseResponse = await getHf19Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf20_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const channelSwaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF20", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF20", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF20", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF20", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF20", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF19", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF20", "status"],
    ['stockSyncChannel: "HF19"', 'stockSyncChannel: "HF20"', "marker"],
  ];
  for (const [before, after, code] of channelSwaps) {
    ops = replaceOnce(ops, before, after, `shopling_stock_hf20_channel_${code}`);
  }
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
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf20_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf20_hf19_checkpoint_missing");
  }

  manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of ["tabs", "windows", "scripting", "debugger"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF20";
  manifest.description = "HF20 preserves HF19 A6 maximum-output pagination and A21 200-row batching, but ports HF10's proven CDP Runtime + Accessibility completion detection to SINGLE sale-status result windows. The watcher starts proactively from RESULT_WAIT, ACKs success first, then closes the managed result window.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF20`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const requiredBackgroundGuards = [
    'importScripts("background-v060.js")',
    "Accessibility.getFullAXTree",
    'chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate"',
    'const SINGLE_STAGE_V061 = "STOCK_SINGLE_POPUP_STAGE_V011"',
    "contentHintRequired: false",
    "HF20_SINGLE_PRICE_V044_STYLE_CDP_AX_AUTOCLOSE",
    "continueNextGoodsKey(latest, sender, completionEvidence)",
    "closeManagedResultV061(terminalProbe.tabId, latest)",
    "chrome.windows.remove(tab.windowId)",
    "chrome.tabs.remove(tabId)",
  ];
  for (const guard of requiredBackgroundGuards) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf20_background_guard_missing:${guard}`);
  }
  if (ops.includes("_HF19")) throw new Error("shopling_stock_hf20_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF20";')) {
    throw new Error("shopling_stock_hf20_start_channel_missing");
  }
  if (!ops.includes('stockSyncChannel: "HF20"')) throw new Error("shopling_stock_hf20_channel_marker_missing");

  for (const required of [
    "background-v055.js",
    "background-v059.js",
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-stock-result-v050.js",
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf20_checkpoint_missing:${required}`);
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf20_missing_packaged_file:${file}`);
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
      pageChannel: "HF20_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      optionFlow: "HF10_UNCHANGED",
      singleResultWatcherStart: "RESULT_WAIT_PLUS_SHOPLING_TAB_NAVIGATION_NO_CONTENT_HINT_REQUIRED",
      singleCompletionDetection: "HF10_PRICE_V044_STYLE_SCRIPTING_PLUS_CDP_RUNTIME_PLUS_ACCESSIBILITY",
      singleCompletionTerminal: "TOTAL_SUCCESS_FAILURE_COUNTS_OR_LEGACY_PRODUCT_FOOTER",
      singleCompletionStabilityMs: 2500,
      singleAckBeforeClose: true,
      singleManagedClose: "HF10_STYLE_WINDOW_REMOVE_OR_TAB_REMOVE",
      debuggerPermission: manifest.permissions.includes("debugger"),
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf20.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF20_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
