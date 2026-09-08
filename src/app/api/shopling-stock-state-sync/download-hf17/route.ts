import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf16Download } from "../download-hf16/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF17_SINGLE_EXACT_SALE_STATUS_POPUP_LOCATORS";
const BACKGROUND_FILE = "background-v059.js";
const SINGLE_POPUP_OLD = "content-stock-single-popup-v011.js";
const SINGLE_POPUP_NEW = "content-stock-single-popup-v012.js";
const CONTENT_OPS = "content-ops-v021.js";
const POPUP_MATCH = "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf16Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf17_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  const singlePopup = await readFile(path.join(root, SINGLE_POPUP_NEW), "utf8");
  new Function(background);
  new Function(singlePopup);
  entries[BACKGROUND_FILE] = strToU8(background);
  entries[SINGLE_POPUP_NEW] = strToU8(singlePopup);

  // HF17 gets an isolated page channel so HF16 left installed cannot receive this test.
  let ops = strFromU8(opsBytes);
  const channelSwaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF17", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF17", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF17", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF17", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF17", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF16", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF17", "status"],
    ['stockSyncChannel: "HF16"', 'stockSyncChannel: "HF17"', "marker"],
  ];
  for (const [before, after, code] of channelSwaps) {
    ops = replaceOnce(ops, before, after, `shopling_stock_hf17_channel_${code}`);
  }
  new Function(ops);
  entries[CONTENT_OPS] = strToU8(ops);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
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
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf17_manifest_version_mismatch");
  if (manifest.background.service_worker !== "background-v058.js") throw new Error("shopling_stock_hf17_hf16_checkpoint_missing");

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF17";
  manifest.description = "HF17: exact SINGLE A21 sale-status popup locators + stage-independent popup claim; A6/A21 existing-row policy and HF10 option flow preserved.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF17`;
  manifest.content_scripts = manifest.content_scripts.filter((script) => !script.js?.includes(SINGLE_POPUP_OLD) && !script.js?.includes(SINGLE_POPUP_NEW));
  manifest.content_scripts.push({
    matches: [POPUP_MATCH],
    js: [SINGLE_POPUP_NEW],
    all_frames: true,
    run_at: "document_idle",
  });
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes('importScripts("background-v058.js")')) throw new Error("shopling_stock_hf17_hf16_import_missing");
  if (!background.includes("STOCK_SINGLE_POPUP_CLAIM_V012")) throw new Error("shopling_stock_hf17_claim_v012_missing");
  if (!singlePopup.includes("V012_EXACT_MODE_CELL_AND_STATUS_ROW")) throw new Error("shopling_stock_hf17_exact_locator_marker_missing");
  if (!singlePopup.includes('exactTextNodes("상품판매상태송신")')) throw new Error("shopling_stock_hf17_mode_exact_text_missing");
  if (!singlePopup.includes("statusRadio(targetLabel)")) throw new Error("shopling_stock_hf17_status_row_locator_missing");
  if (ops.includes("_HF16")) throw new Error("shopling_stock_hf17_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF17";')) throw new Error("shopling_stock_hf17_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF17"')) throw new Error("shopling_stock_hf17_channel_marker_missing");

  for (const required of [
    "background-v055.js",
    "background-v056.js",
    "background-v057.js",
    "background-v058.js",
    BACKGROUND_FILE,
    "content-a21-canonical-v014.js",
    SINGLE_POPUP_NEW,
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf17_checkpoint_missing:${required}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const popupSha256 = createHash("sha256").update(singlePopup).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF17_ONLY",
      singleFlow: "A6_READ_ONLY_TO_A21_EXISTING_ROWS_ONLY",
      singleA4Used: false,
      singlePopupClaim: "EXACT_URL_AND_RUNNING_SINGLE_NOT_MUTABLE_CANONICAL_STAGE",
      singlePopupModeLocator: "EXACT_TEXT_CELL_상품판매상태송신",
      singlePopupStatusLocator: "EXACT_STATUS_ROW_품절_OR_판매중",
      singleMissingRequestedGoodsKeys: "IGNORE_AS_DELETED_OR_STALE",
      optionFlow: "HF10_UNCHANGED",
      backgroundSha256,
      popupSha256,
      opsSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf17.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF17_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-popup-sha256": popupSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
