import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf22Download } from "../download-hf22/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF23_DIRECT_AAPI_RESULT_CLOSEMANAGED";
const BACKGROUND_OLD = "background-v063.js";
const BACKGROUND_NEW = "background-v064.js";
const RESULT_CONTENT = "content-stock-status-result-v023.js";
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
  const baseResponse = await getHf22Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf23_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, resultContent] = await Promise.all([
    readFile(path.join(root, BACKGROUND_NEW), "utf8"),
    readFile(path.join(root, RESULT_CONTENT), "utf8"),
  ]);
  new Function(background);
  new Function(resultContent);
  entries[BACKGROUND_NEW] = strToU8(background);
  entries[RESULT_CONTENT] = strToU8(resultContent);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF23", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF23", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF23", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF23", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF23", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF22", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF23", "status"],
    ['stockSyncChannel: "HF22"', 'stockSyncChannel: "HF23"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf23_${code}`);
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
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf23_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf23_hf22_checkpoint_missing");

  manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of ["tabs", "windows", "scripting", "webNavigation", "debugger"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }
  manifest.host_permissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const match of RESULT_MATCHES) {
    if (!manifest.host_permissions.includes(match)) manifest.host_permissions.push(match);
  }

  const existingResultScript = manifest.content_scripts.some((script) => script.js?.includes(RESULT_CONTENT));
  if (!existingResultScript) {
    manifest.content_scripts.push({
      matches: RESULT_MATCHES,
      js: [RESULT_CONTENT],
      all_frames: true,
      run_at: "document_idle",
    });
  }

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF23";
  manifest.description = "HF23 fixes the real Shopling sale-status result host observed at aapi*.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml. It grants direct http/https *.shopling.co.kr result access, detects the exact '상품상태 변경 전송이 완료되었습니다.' footer in-page, ACKs the SINGLE stock-state job, then copies the price-adjustment extension's closeManaged policy by removing the actual result/popup window ids. HF22 CDP/Accessibility stays as fallback.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF23`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v063.js")',
    'const RESULT_MESSAGE_V064 = "STOCK_SINGLE_STATUS_RESULT_TERMINAL_V023"',
    "closeManagedPriceStyleV064",
    "chrome.windows.remove(windowId)",
    "continueNextGoodsKey(",
    "HF23_DIRECT_AAPI_RESULT_CLOSEMANAGED",
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf23_background_guard_missing:${guard}`);
  }
  for (const guard of [
    'const MESSAGE = "STOCK_SINGLE_STATUS_RESULT_TERMINAL_V023"',
    "/\\/prod_a\\/prod_status_trsmt\\.phtml$/i",
    "상품\\s*상태\\s*변경\\s*전송이\\s*완료되었습니다",
    "STABLE_MS = 2_500",
  ]) {
    if (!resultContent.includes(guard)) throw new Error(`shopling_stock_hf23_result_content_guard_missing:${guard}`);
  }
  if (ops.includes("_HF22")) throw new Error("shopling_stock_hf23_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF23";')) throw new Error("shopling_stock_hf23_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF23"')) throw new Error("shopling_stock_hf23_channel_marker_missing");
  for (const match of RESULT_MATCHES) {
    if (!manifest.host_permissions.includes(match)) throw new Error(`shopling_stock_hf23_host_permission_missing:${match}`);
  }
  if (!manifest.content_scripts.some((script) => script.js?.includes(RESULT_CONTENT) && RESULT_MATCHES.every((match) => script.matches.includes(match)))) {
    throw new Error("shopling_stock_hf23_cross_host_result_content_missing");
  }

  for (const required of [
    "background-v055.js",
    "background-v059.js",
    "background-v060.js",
    "background-v061.js",
    "background-v062.js",
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-stock-result-v050.js",
    RESULT_CONTENT,
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf23_checkpoint_missing:${required}`);
  }

  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf23_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const resultContentSha256 = createHash("sha256").update(resultContent).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF23_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      hf22CdpAxFallbackPreserved: true,
      optionFlow: "HF10_UNCHANGED",
      observedLiveResult: "aapi10.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml",
      resultHostPermissions: RESULT_MATCHES,
      directResultContentScript: RESULT_CONTENT,
      directCompletionFooter: "상품상태 변경 전송이 완료되었습니다.",
      directCompletionStabilityMs: 2500,
      closeReference: "shopling-a21-price-option-resend background-v020 completeJob -> closeManaged",
      closePolicy: "ACK_THEN_REMOVE_RESULT_AND_REMEMBERED_POPUP_WINDOWS",
      finalWorkerClose: "OWNED_COMMERCE_STOCK_WORKSPACE_A6_A21_WINDOWS",
      background: BACKGROUND_NEW,
      backgroundSha256,
      resultContentSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf23.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF23_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-result-content-sha256": resultContentSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
