import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf17Download } from "../download-hf17/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF18_SINGLE_RESULT_COUNTS_AUTOCLOSE_AND_MARKET_FAILURE_ADVISORY";
const BACKGROUND_SINGLE = "background-v056.js";
const RESULT_WORKER = "content-stock-result-v050.js";
const CONTENT_OPS = "content-ops-v021.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const TERMINAL_COUNTS_EXPR = `(() => {
              const totals = [...text.matchAll(/총건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
              const successes = [...text.matchAll(/성공건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
              const failures = [...text.matchAll(/실패건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
              return totals.length > 0 && totals.length === successes.length && totals.length === failures.length && totals.every((total, index) => total === successes[index] + failures[index]);
            })()`;

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf17Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const backgroundBytes = entries[BACKGROUND_SINGLE];
  const resultBytes = entries[RESULT_WORKER];
  const opsBytes = entries[CONTENT_OPS];
  const manifestBytes = entries["manifest.json"];
  if (!backgroundBytes || !resultBytes || !opsBytes || !manifestBytes) {
    throw new Error("shopling_stock_hf18_required_entry_missing");
  }

  let background = strFromU8(backgroundBytes);
  background = replaceOnce(
    background,
    `          productComplete: /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text),`,
    `          productComplete:\n            /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) ||\n            /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text) ||\n            ${TERMINAL_COUNTS_EXPR},`,
    "shopling_stock_hf18_background_terminal_counts",
  );
  background = replaceOnce(
    background,
    `      const handled = await legacyHandleEvidenceV056({\n        ...message,\n        evidence: {\n          ...evidence,\n          processing: false,\n          productComplete: true,\n          readyState: "complete",\n          stableCompletionVerified: true,\n          stableCompletionMs: stable.stableMs,\n        },\n      }, sender);`,
    `      const completionEvidence = {\n        ...evidence,\n        processing: false,\n        productComplete: true,\n        readyState: "complete",\n        stableCompletionVerified: true,\n        stableCompletionMs: stable.stableMs,\n        shoplingBatchComplete: true,\n        marketFailureCount: Number(evidence.failureCount || 0),\n        marketFailuresAdvisory: Number(evidence.failureCount || 0) > 0 || Boolean(evidence.explicitFailure),\n        explicitFailure: false,\n      };\n      const handled = await continueNextGoodsKey(latest, sender, completionEvidence);`,
    "shopling_stock_hf18_single_completion_success_policy",
  );
  new Function(background);
  entries[BACKGROUND_SINGLE] = strToU8(background);

  let resultWorker = strFromU8(resultBytes);
  resultWorker = replaceOnce(
    resultWorker,
    `      productComplete:\n        /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) ||\n        /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text),`,
    `      productComplete:\n        /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) ||\n        /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text) ||\n        ${TERMINAL_COUNTS_EXPR},`,
    "shopling_stock_hf18_result_terminal_counts",
  );
  new Function(resultWorker);
  entries[RESULT_WORKER] = strToU8(resultWorker);

  let ops = strFromU8(opsBytes);
  const channelSwaps: Array<[string, string, string]> = [
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF18", "ready"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF18", "ping"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF18", "start"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF18", "result"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF18", "progress"],
    ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF18", "status"],
    ['stockSyncChannel: "HF17"', 'stockSyncChannel: "HF18"', "marker"],
  ];
  for (const [before, after, code] of channelSwaps) {
    ops = replaceOnce(ops, before, after, `shopling_stock_hf18_channel_${code}`);
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
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf18_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v059.js") {
    throw new Error("shopling_stock_hf18_hf17_checkpoint_missing");
  }

  manifest.name = "Commerce OS · Shopling Stock State Sync HF18";
  manifest.description = "HF18: terminal result-count completion + auto-close for SINGLE sale-status sends; per-market failures remain advisory while Shopling batch completion is accepted.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF18`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes("shoplingBatchComplete: true")) throw new Error("shopling_stock_hf18_batch_complete_marker_missing");
  if (!background.includes("const handled = await continueNextGoodsKey(latest, sender, completionEvidence)")) throw new Error("shopling_stock_hf18_direct_completion_advance_missing");
  if (!background.includes("marketFailuresAdvisory")) throw new Error("shopling_stock_hf18_market_failure_advisory_missing");
  if (!background.includes("총건수")) throw new Error("shopling_stock_hf18_background_count_probe_missing");
  if (!resultWorker.includes("총건수")) throw new Error("shopling_stock_hf18_result_count_probe_missing");
  if (ops.includes("_HF17")) throw new Error("shopling_stock_hf18_old_channel_still_present");
  if (!ops.includes('const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF18";')) throw new Error("shopling_stock_hf18_start_channel_missing");
  if (!ops.includes('stockSyncChannel: "HF18"')) throw new Error("shopling_stock_hf18_channel_marker_missing");

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const resultSha256 = createHash("sha256").update(resultWorker).digest("hex");
  const opsSha256 = createHash("sha256").update(ops).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF18_ONLY",
      singleFlow: "A6_READ_ONLY_TO_A21_EXISTING_ROWS_ONLY",
      singleA4Used: false,
      singleCompletionDetection: "FOOTER_OR_ALL_TOTAL_SUCCESS_FAILURE_BLOCKS_TERMINAL",
      singleCompletionStabilityMs: 2500,
      singleResultAutoClose: true,
      perMarketFailures: "ADVISORY_NOT_BATCH_FAILURE",
      singleMissingRequestedGoodsKeys: "IGNORE_AS_DELETED_OR_STALE",
      optionFlow: "HF10_UNCHANGED",
      backgroundSha256,
      resultSha256,
      opsSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf18.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF18_ONLY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-result-sha256": resultSha256,
      "x-stock-content-ops-sha256": opsSha256,
    },
  });
}
