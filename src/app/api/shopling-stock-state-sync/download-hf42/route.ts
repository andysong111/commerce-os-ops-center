import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf42OptionResultWatcher,
  SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS,
} from "@/lib/shoplingStockHf42Patch";
import { GET as getHf41Download } from "../download-hf41/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.9";
const VERSION = "0.6.10";
const HOTFIX = "HF42_OPTION_TERMINAL_FOOTER_PRECEDENCE";
const OPTION_RESULT_WATCHER = "background-v055.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf41Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const watcherBytes = entries[OPTION_RESULT_WATCHER];
  if (!manifestBytes || !watcherBytes) {
    throw new Error("shopling_stock_hf42_required_entry_missing");
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
    throw new Error("shopling_stock_hf42_manifest_version_mismatch");
  }

  const watcher = patchShoplingStockHf42OptionResultWatcher(
    strFromU8(watcherBytes),
  );
  new Function(watcher);
  for (const guard of [
    "const WAIT_LIMIT_MS_V055 = 30 * 60_000;",
    "const processing = staleProcessingSignal && !expectedFooter;",
    'runDefinitiveWatcherV055("serviceWorkerBoot")',
    "상품\\s*옵션\\s*수정\\s*전송이\\s*완료되었습니다",
  ]) {
    if (!watcher.includes(guard)) {
      throw new Error(`shopling_stock_hf42_option_guard_missing:${guard}`);
    }
  }
  if (watcher.includes("const WAIT_LIMIT_MS_V055 = 180_000;")) {
    throw new Error("shopling_stock_hf42_short_option_watch_present");
  }
  entries[OPTION_RESULT_WATCHER] = strToU8(watcher);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF42";
  manifest.description =
    "HF42 treats the exact Shopling option-completion footer as terminal even when stale per-market headings still say transmission is in progress, and recovers the completed option result after service-worker reload without resending.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF42`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    OPTION_RESULT_WATCHER,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf42_missing_packaged_file:${file}`);
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
        optionResultWatchMs: SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS,
        exactOptionFooterOverridesStaleProcessingHeadings: true,
        serviceWorkerBootRecovery: true,
        resendRequiredForRecovery: false,
        marketFailuresRemainAdvisory: true,
        incidentRegression:
          "BCB6-2_EXACT_OPTION_FOOTER_WITH_STALE_TRANSMITTING_HEADINGS",
        optionResultWatcher: OPTION_RESULT_WATCHER,
        optionResultWatcherSha256: watcherSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.10-hf42.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-option-result-watch-ms": String(
        SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS,
      ),
      "x-stock-option-result-watcher-sha256": watcherSha256,
    },
  });
}
