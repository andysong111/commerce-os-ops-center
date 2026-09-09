import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf27Download } from "../download-hf27/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF28_TWO_LANE_OVERLAP_AFTER_SUBMIT";
const BACKGROUND_OLD = "background-v068.js";
const BACKGROUND_NEW = "background-v069.js";
const OPS_CONTENT = "content-ops-v021.js";
const PARALLEL_CONTENT = "content-ops-parallel-v001.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf27Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf28_manifest_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, parallelContent] = await Promise.all([
    readFile(path.join(root, BACKGROUND_NEW), "utf8"),
    readFile(path.join(root, PARALLEL_CONTENT), "utf8"),
  ]);
  new Function(background);
  new Function(parallelContent);
  entries[BACKGROUND_NEW] = strToU8(background);
  entries[PARALLEL_CONTENT] = strToU8(parallelContent);

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    permissions?: string[];
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

  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf28_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf28_hf27_checkpoint_missing");
  }

  const opsEntry = manifest.content_scripts.find((script) => script.js?.includes(OPS_CONTENT));
  if (!opsEntry) throw new Error("shopling_stock_hf28_ops_content_entry_missing");
  if (!opsEntry.js.includes(PARALLEL_CONTENT)) opsEntry.js.push(PARALLEL_CONTENT);

  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF28";
  manifest.description = "HF28 adds a two-lane overlap checkpoint without destabilizing the proven legacy single-active engine. Lane 1 runs until Shopling submission is objectively confirmed, then its exact result tab is detached into an isolated watcher. The legacy slot is released, a fresh Shopling window/workspace is opened, and Lane 2 starts immediately while Lane 1 is still processing. Window closure is not a completion gate. HF27 canonical SUCCEEDED persistence, A6 max-pagination, A21 200-row batching and HF10 OPTION behavior remain packaged.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF28`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v068.js")',
    'const PARALLEL_START = "STOCK_SYNC_PARALLEL_START_V028"',
    'mode: "TWO_LANE_OVERLAP_AFTER_SUBMIT"',
    'windowCloseGate: "IGNORED"',
    'await saveActive(null)',
    'await chrome.windows.create({',
    'closeAttempted: false',
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf28_background_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START',
    'STOCK_SYNC_PARALLEL_START_V028',
    'STOCK_SYNC_PARALLEL_STATUS',
  ]) {
    if (!parallelContent.includes(guard)) {
      throw new Error(`shopling_stock_hf28_parallel_content_guard_missing:${guard}`);
    }
  }

  for (const required of [BACKGROUND_OLD, BACKGROUND_NEW, OPS_CONTENT, PARALLEL_CONTENT]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf28_checkpoint_missing:${required}`);
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf28_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const parallelContentSha256 = createHash("sha256").update(parallelContent).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      legacyPageChannel: "HF27_COMPAT",
      parallelChannel: "HF28_GENERIC_SIDECAR",
      parallelMode: "TWO_LANE_OVERLAP_AFTER_SUBMIT",
      lane1: "LEGACY_SUBMIT_THEN_DETACHED_EXACT_RESULT_WATCHER",
      lane2: "FRESH_SHOPLING_WINDOW_AND_FRESH_WORKSPACE",
      sameBarcodeParallelBlocked: true,
      windowCloseRequiredForProgress: false,
      windowClosePolicy: "BEST_EFFORT_ONLY",
      detachedLaneCloseAttempted: false,
      hf27CanonicalSucceededPreserved: true,
      a6MaxPaginationPreserved: true,
      a21Output200Preserved: true,
      hf10OptionPreserved: true,
      background: BACKGROUND_NEW,
      backgroundSha256,
      parallelContent: PARALLEL_CONTENT,
      parallelContentSha256,
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf28.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-parallel-mode": "TWO_LANE_OVERLAP_AFTER_SUBMIT",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-parallel-content-sha256": parallelContentSha256,
    },
  });
}
