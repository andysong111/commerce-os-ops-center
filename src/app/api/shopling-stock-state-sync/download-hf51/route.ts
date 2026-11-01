import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf50Download } from "../download-hf50/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.15";
const VERSION = "0.6.16";
const HOTFIX = "HF51_DURABLE_PARALLEL_RESUME_WAKEUP";
const BACKGROUND_OLD = "background-v074.js";
const BACKGROUND_NEW = "background-v075.js";
const RESULT_OLD = "content-stock-result-v050.js";
const RESULT_NEW = "content-stock-result-v051.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf50Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BACKGROUND_OLD] || !entries[RESULT_OLD]) {
    throw new Error("shopling_stock_hf51_required_entry_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BACKGROUND_OLD
  ) {
    throw new Error("shopling_stock_hf51_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  const resultObserver = await readFile(path.join(root, RESULT_NEW), "utf8");
  new Function(background);
  new Function(resultObserver);
  for (const guard of [
    "commerce-os-shopling-stock-parallel-resume-hf51",
    "commerceOsShoplingStockParallelV028",
    "state.secondStarted !== true",
    "chrome.storage.onChanged.addListener",
    "chrome.alarms.onAlarm.addListener",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf51_background_guard_missing:${guard}`);
    }
  }
  for (const forbidden of [
    "chrome.tabs.update",
    "chrome.windows.create",
    "STOCK_SYNC_EXECUTE",
  ]) {
    if (background.includes(forbidden)) {
      throw new Error(`shopling_stock_hf51_background_write_forbidden:${forbidden}`);
    }
  }

  entries[BACKGROUND_NEW] = strToU8(background);
  entries[RESULT_NEW] = strToU8(resultObserver);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    js: script.js.map((file) => file === RESULT_OLD ? RESULT_NEW : file),
  }));
  manifest.name = "Commerce OS · Shopling Stock State Sync HF51";
  manifest.description =
    "HF51 keeps a durable wakeup while a persisted two-lane batch is waiting to start Lane 2 and recognizes Shopling's shared 상품상태 변경 terminal footer for both exact active job types. The alarm never dispatches or mutates a product.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF51`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf51_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundHash = createHash("sha256").update(background).digest("hex");
  const resultObserverHash = createHash("sha256").update(resultObserver).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        parallelResumeAlarm: true,
        alarmDispatchesShoplingWrite: false,
        secondLaneOwner: "HF28_COORDINATOR",
        duplicateSecondLaneStartBlocked: true,
        incidentRegression:
          "BZZ341_1_SUCCEEDED_THEN_WORKER_GAP_AND_BBD8_1_SHARED_TERMINAL_FOOTER_WAS_NOT_CLASSIFIED",
        backgroundHash,
        resultObserverHash,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.16-hf51.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-parallel-resume": "durable-wakeup-only",
      "x-stock-background-sha256": backgroundHash,
      "x-stock-result-observer-sha256": resultObserverHash,
    },
  });
}
