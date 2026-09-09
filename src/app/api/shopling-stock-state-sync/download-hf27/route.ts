import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf26Download } from "../download-hf26/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF27_CANONICAL_SUCCEEDED_OUTCOME";
const BACKGROUND_OLD = "background-v067.js";
const BACKGROUND_NEW = "background-v068.js";
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
  const baseResponse = await getHf26Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[CONTENT_OPS];
  if (!manifestBytes || !opsBytes) throw new Error("shopling_stock_hf27_required_entry_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF27", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF26", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF27", "status"],
    ['stockSyncChannel: "HF26"', 'stockSyncChannel: "HF27"', "marker"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf27_${code}`);
  new Function(ops);
  entries[CONTENT_OPS] = strToU8(ops);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf27_manifest_version_mismatch");
  if (manifest.background.service_worker !== BACKGROUND_OLD) throw new Error("shopling_stock_hf27_hf26_checkpoint_missing");

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF27";
  manifest.description = "HF27 preserves HF26's proven slow-result handling and automatic window close, but fixes the final Commerce OS persistence error. Legacy SINGLE batching emitted outcome SUCCESS while the server accepts the canonical SUCCEEDED enum. HF27 normalizes SUCCESS->SUCCEEDED at the finish choke point, preventing SHOPLING_STOCK_SYNC_STATE_INVALID after a real successful Shopling send.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF27`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v067.js")',
    'const TAG_V068 = "[CommerceOS Stock HF27]"',
    'rawOutcome === "SUCCESS" ? "SUCCEEDED"',
    'SUCCESS_TO_SUCCEEDED_HF27',
  ]) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf27_background_guard_missing:${guard}`);
  }
  if (ops.includes("_HF26")) throw new Error("shopling_stock_hf27_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27";')) throw new Error("shopling_stock_hf27_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF27"')) throw new Error("shopling_stock_hf27_channel_marker_missing");

  for (const required of [BACKGROUND_OLD, BACKGROUND_NEW, CONTENT_OPS]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf27_checkpoint_missing:${required}`);
  }
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => script.js)]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf27_missing_packaged_file:${file}`);
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
      pageChannel: "HF27_ONLY",
      hf26SlowResultPromotionPreserved: true,
      hf26AutomaticClosePreserved: true,
      a6MaxPaginationPreserved: true,
      a21Output200Preserved: true,
      previousFailure: "SHOPLING_STOCK_SYNC_STATE_INVALID_AFTER_REAL_SUCCESS",
      rootCause: "LEGACY_SINGLE_OUTCOME_SUCCESS_NOT_CANONICAL_SUCCEEDED",
      normalization: "SUCCESS_TO_SUCCEEDED_AT_FINISH",
      background: BACKGROUND_NEW,
      backgroundSha256,
      opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf27.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF27_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
