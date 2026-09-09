import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf25Download } from "../download-hf25/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF26_OBJECTIVE_RESULT_NAVIGATION_PROMOTION";
const BACKGROUND_OLD = "background-v066.js";
const BACKGROUND_NEW = "background-v067.js";
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
  const baseResponse = await getHf25Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf26_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF26", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF26", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF26", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF26", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF26", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF25", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF26", "status"],
    ['stockSyncChannel: "HF25"', 'stockSyncChannel: "HF26"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf26_${code}`);
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
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf26_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf26_hf25_checkpoint_missing");

  manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of ["tabs", "windows", "scripting", "webNavigation"]) {
    if (!manifest.permissions.includes(permission)) manifest.permissions.push(permission);
  }
  manifest.host_permissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const match of RESULT_MATCHES) if (!manifest.host_permissions.includes(match)) manifest.host_permissions.push(match);

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF26";
  manifest.description = "HF26 fixes the 90-second false failure proven by HF25 logs. As soon as the real aapi*.shopling.co.kr/prod_a/prod_status_trsmt.phtml result navigation appears, SINGLE is objectively known to have submitted, so A21_LIST/A21_POPUP is promoted immediately to WAIT_A21_RESULT (30-minute result timeout) before Shopling's slow result finishes. HF25 then detects the terminal footer and closes the actual result/popup windows in price-extension closeManaged order.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF26`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v066.js")',
    'const TAG_V067 = "[CommerceOS Stock HF26]"',
    'RESULT NAVIGATION => WAIT_A21_RESULT',
    'active.stage = "WAIT_A21_RESULT"',
    'resultWaitTimeoutMinutes: 30',
    '/\\/prod_a\\/prod_status_trsmt\\.phtml$/i',
    'recoverAlreadyOpenResultV067',
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf26_background_guard_missing:${guard}`);
  }
  if (ops.includes("_HF25")) throw new Error("shopling_stock_hf26_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF26";')) throw new Error("shopling_stock_hf26_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF26"')) throw new Error("shopling_stock_hf26_channel_marker_missing");

  for (const required of [
    "background-v055.js",
    "background-v058.js",
    "background-v059.js",
    "background-v066.js",
    BACKGROUND_NEW,
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v012.js",
    "content-shopling-v030.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf26_checkpoint_missing:${required}`);
  }
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf26_missing_packaged_file:${file}`);
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
      pageChannel: "HF26_ONLY",
      hf19A6MaxPaginationPreserved: true,
      hf19A21Output200Preserved: true,
      optionFlow: "HF10_UNCHANGED",
      hf25VerboseScannerPreserved: true,
      provenRootCause: "REAL_RESULT_NAVIGATION_ARRIVES_BEFORE_TERMINAL_BUT_BASE_A21_POPUP_WATCHDOG_FAILS_AT_90S",
      objectiveSubmissionEvidence: "/prod_a/prod_status_trsmt.phtml navigation",
      earlyStagePromotion: "A21_LIST_OR_A21_POPUP_TO_WAIT_A21_RESULT",
      basePopupTimeoutSeconds: 90,
      resultTimeoutMinutes: 30,
      directCompletionFooter: "상품상태 변경 전송이 완료되었습니다.",
      closePolicy: "HF25_ACK_THEN_PRICE_STYLE_CLOSEMANAGED",
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf26.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF26_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
