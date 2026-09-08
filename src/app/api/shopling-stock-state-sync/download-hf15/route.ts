import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf14Download } from "../download-hf14/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF15_ISOLATED_PAGE_CHANNEL_BLOCK_LEGACY_A4_INSTANCES";
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
  const baseResponse = await getHf14Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const opsBytes = entries[CONTENT_OPS];
  const manifestBytes = entries["manifest.json"];
  if (!opsBytes || !manifestBytes) throw new Error("shopling_stock_hf15_required_entry_missing");

  let ops = strFromU8(opsBytes);
  const swaps: Array<[string, string, string]> = [
    ['const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";', 'const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF15";', "ready"],
    ['const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";', 'const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF15";', "ping"],
    ['const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";', 'const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF15";', "start"],
    ['const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";', 'const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF15";', "result"],
    ['const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";', 'const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF15";', "progress"],
    ['const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";', 'const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF15";', "status"],
  ];
  for (const [before, after, code] of swaps) ops = replaceOnce(ops, before, after, `shopling_stock_hf15_${code}_namespace`);
  ops = replaceOnce(
    ops,
    'const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);',
    'const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION, stockSyncChannel: "HF15" }, location.origin);',
    "shopling_stock_hf15_channel_marker",
  );
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
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) throw new Error("shopling_stock_hf15_manifest_version_mismatch");
  if (manifest.background.service_worker !== "background-v058.js") throw new Error("shopling_stock_hf15_hf14_checkpoint_missing");
  if (!manifest.content_scripts.some((row) => row.js?.includes(CONTENT_OPS))) throw new Error("shopling_stock_hf15_content_ops_not_packaged");

  manifest.name = "Commerce OS · Shopling Stock State Sync HF15";
  manifest.description = "HF15 isolated page channel: older installed stock-sync copies cannot receive new START/PING commands.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF15`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const required of [
    "background-v055.js",
    "background-v056.js",
    "background-v057.js",
    "background-v058.js",
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v011.js",
    CONTENT_OPS,
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf15_checkpoint_missing:${required}`);
  }

  const forbiddenGenericListener = 'const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";';
  if (ops.includes(forbiddenGenericListener)) throw new Error("shopling_stock_hf15_generic_start_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF15";')) throw new Error("shopling_stock_hf15_namespaced_start_missing");
  if (!ops.includes('stockSyncChannel: "HF15"')) throw new Error("shopling_stock_hf15_marker_missing");

  const zip = zipSync(entries, { level: 9 });
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF15_ONLY",
      genericStartAccepted: false,
      genericPingAccepted: false,
      hf14SingleExistingRowsPolicyPreserved: true,
      hf10OptionCheckpointPreserved: true,
      background: manifest.background.service_worker,
      contentOps: CONTENT_OPS,
      contentOpsSha256: opsSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf15.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF15_ONLY",
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
