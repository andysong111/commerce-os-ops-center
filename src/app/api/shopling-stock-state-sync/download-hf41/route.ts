import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf41ResultWatcher,
  SHOPLING_STOCK_HF41_RESULT_WATCH_MS,
} from "@/lib/shoplingStockHf41Patch";
import { GET as getHf40Download } from "../download-hf40/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.8";
const VERSION = "0.6.9";
const HOTFIX = "HF41_LONG_SINGLE_RESULT_RECOVERY";
const RESULT_WATCHER = "background-v066.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf40Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const watcherBytes = entries[RESULT_WATCHER];
  if (!manifestBytes || !watcherBytes) {
    throw new Error("shopling_stock_hf41_required_entry_missing");
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
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf41_manifest_version_mismatch");
  }

  const watcher = patchShoplingStockHf41ResultWatcher(
    strFromU8(watcherBytes),
  );
  new Function(watcher);
  for (const guard of [
    "const WAIT_MS = 30 * 60_000;",
    'runWatcher("serviceWorkerBoot", null)',
    "상품상태 변경 전송이 완료되었습니다",
    "marketFailuresAdvisory",
  ]) {
    if (!watcher.includes(guard)) {
      throw new Error(`shopling_stock_hf41_result_guard_missing:${guard}`);
    }
  }
  if (watcher.includes("const WAIT_MS = 95_000;")) {
    throw new Error("shopling_stock_hf41_short_result_watch_present");
  }
  entries[RESULT_WATCHER] = strToU8(watcher);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF41";
  manifest.description =
    "HF41 keeps the exact Shopling SINGLE result watcher alive for the full 30-minute result window and recovers an already-completed result tab after extension reload without resending the product.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF41`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    RESULT_WATCHER,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf41_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const watcherSha256 = createHash("sha256").update(watcher).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        singleResultWatchMs: SHOPLING_STOCK_HF41_RESULT_WATCH_MS,
        liveObservedResultDurationMs: 125_000,
        serviceWorkerBootRecoveryPreserved: true,
        resendRequiredForRecovery: false,
        exactTerminalFooterRequired: true,
        marketFailuresRemainAdvisory: true,
        incidentRegression:
          "BBB4-3_RESULT_COMPLETED_AFTER_HF40_95_SECOND_WATCHER_EXIT",
        resultWatcher: RESULT_WATCHER,
        resultWatcherSha256: watcherSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.9-hf41.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-result-watch-ms": String(SHOPLING_STOCK_HF41_RESULT_WATCH_MS),
      "x-stock-result-watcher-sha256": watcherSha256,
    },
  });
}
