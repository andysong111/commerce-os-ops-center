import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf27Download } from "../download-hf27/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.5.5";
const VERSION = "0.5.6";
const HOTFIX = "HF28_TWO_LANE_OVERLAP_AFTER_SUBMIT_HEARTBEAT_WATCHDOG";
const BACKGROUND_OLD = "background-v068.js";
const BACKGROUND_HF28 = "background-v069.js";
const BACKGROUND_NEW = "background-v070.js";
const OPS_CONTENT = "content-ops-v021.js";
const PARALLEL_CONTENT = "content-ops-parallel-v001.js";
const HEARTBEAT_CONTENT = "content-ops-heartbeat-v001.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf27Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf28_manifest_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [hf28Background, watchdogBackground, parallelContent, heartbeatContent] =
    await Promise.all([
      readFile(path.join(root, BACKGROUND_HF28), "utf8"),
      readFile(path.join(root, BACKGROUND_NEW), "utf8"),
      readFile(path.join(root, PARALLEL_CONTENT), "utf8"),
      readFile(path.join(root, HEARTBEAT_CONTENT), "utf8"),
    ]);
  new Function(hf28Background);
  new Function(watchdogBackground);
  new Function(parallelContent);
  new Function(heartbeatContent);
  entries[BACKGROUND_HF28] = strToU8(hf28Background);
  entries[BACKGROUND_NEW] = strToU8(watchdogBackground);
  entries[PARALLEL_CONTENT] = strToU8(parallelContent);
  entries[HEARTBEAT_CONTENT] = strToU8(heartbeatContent);

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

  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf28_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf28_hf27_checkpoint_missing");
  }

  const opsEntry = manifest.content_scripts.find((script) =>
    script.js?.includes(OPS_CONTENT),
  );
  if (!opsEntry) throw new Error("shopling_stock_hf28_ops_content_entry_missing");
  if (!opsEntry.js.includes(PARALLEL_CONTENT)) opsEntry.js.push(PARALLEL_CONTENT);
  if (!opsEntry.js.includes(HEARTBEAT_CONTENT)) opsEntry.js.push(HEARTBEAT_CONTENT);

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF28";
  manifest.description =
    "HF28 keeps the proven two-lane overlap flow and replaces the legacy 30-second re-dispatch watchdog with observe-only health checks plus progress heartbeats. A healthy slow A6/API/A21 step is no longer failed at an absolute 60 seconds; pre-submit work fails only after 3 minutes without meaningful progress, with a 30-minute hard safety cap. Lane 1 result watching, HF27 canonical SUCCEEDED persistence, A6 max-pagination, A21 200-row batching and HF10 OPTION behavior remain packaged.";
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
    if (!hf28Background.includes(guard)) {
      throw new Error(`shopling_stock_hf28_background_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'importScripts("background-v069.js")',
    'const HEARTBEAT_MESSAGE_V070 = "STOCK_SYNC_HEARTBEAT_V070"',
    'watchdog = async function watchdogV070()',
    'watchdogRedispatchOnTick: false',
    'const PRE_SUBMIT_IDLE_TIMEOUT_MS_V070 = 3 * 60 * 1000',
    'const PRE_SUBMIT_HARD_TIMEOUT_MS_V070 = 30 * 60 * 1000',
  ]) {
    if (!watchdogBackground.includes(guard)) {
      throw new Error(`shopling_stock_hf28_watchdog_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START",
    "STOCK_SYNC_PARALLEL_START_V028",
    "STOCK_SYNC_PARALLEL_STATUS",
  ]) {
    if (!parallelContent.includes(guard)) {
      throw new Error(`shopling_stock_hf28_parallel_content_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS",
    "STOCK_SYNC_HEARTBEAT_V070",
    'source: "OPS_PROGRESS"',
  ]) {
    if (!heartbeatContent.includes(guard)) {
      throw new Error(`shopling_stock_hf28_heartbeat_content_guard_missing:${guard}`);
    }
  }

  for (const required of [
    BACKGROUND_OLD,
    BACKGROUND_HF28,
    BACKGROUND_NEW,
    OPS_CONTENT,
    PARALLEL_CONTENT,
    HEARTBEAT_CONTENT,
  ]) {
    if (!entries[required]) {
      throw new Error(`shopling_stock_hf28_checkpoint_missing:${required}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf28_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256")
    .update(watchdogBackground)
    .digest("hex");
  const hf28BackgroundSha256 = createHash("sha256")
    .update(hf28Background)
    .digest("hex");
  const parallelContentSha256 = createHash("sha256")
    .update(parallelContent)
    .digest("hex");
  const heartbeatContentSha256 = createHash("sha256")
    .update(heartbeatContent)
    .digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
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
        watchdogMode: "OBSERVE_ONLY_HEARTBEAT",
        watchdogRedispatchEvery30s: false,
        watchdogHealthObservationSeconds: 30,
        preSubmitIdleTimeoutMinutes: 3,
        preSubmitHardTimeoutMinutes: 30,
        resultTimeoutMinutes: 30,
        hf27CanonicalSucceededPreserved: true,
        a6MaxPaginationPreserved: true,
        a21Output200Preserved: true,
        hf10OptionPreserved: true,
        hf28Background: BACKGROUND_HF28,
        hf28BackgroundSha256,
        background: BACKGROUND_NEW,
        backgroundSha256,
        parallelContent: PARALLEL_CONTENT,
        parallelContentSha256,
        heartbeatContent: HEARTBEAT_CONTENT,
        heartbeatContentSha256,
        liveShoplingVerified: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf28.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-parallel-mode": "TWO_LANE_OVERLAP_AFTER_SUBMIT",
      "x-stock-watchdog-mode": "OBSERVE_ONLY_HEARTBEAT",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-parallel-content-sha256": parallelContentSha256,
      "x-stock-heartbeat-content-sha256": heartbeatContentSha256,
    },
  });
}
