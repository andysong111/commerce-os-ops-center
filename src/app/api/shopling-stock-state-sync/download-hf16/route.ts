import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf15Download } from "../download-hf15/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF16_SINGLE_MISSING_KEY_IMMUTABLE_BATCH_MARKER";
const BACKGROUND_BATCH_FILE = "background-v057.js";
const CANONICAL_LIST_FILE = "content-a21-canonical-v014.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${code}:anchor_not_unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf15Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const backgroundBytes = entries[BACKGROUND_BATCH_FILE];
  const canonicalBytes = entries[CANONICAL_LIST_FILE];
  const manifestBytes = entries["manifest.json"];
  if (!backgroundBytes || !canonicalBytes || !manifestBytes) {
    throw new Error("shopling_stock_hf16_required_entry_missing");
  }

  // Root cause of the repeated false failure:
  // HF14 recognized SINGLE batches from assignment.stage. The literal A21 worker reports
  // SEARCH_SUBMITTED, and HF11 stores that mutable stage. A retry assignment then carried
  // stage=SEARCH_SUBMITTED, so the same SINGLE batch was misclassified as strict OPTION
  // and the deleted/stale goods keys failed again. Use an immutable assignment marker.
  let background = strFromU8(backgroundBytes);
  background = replaceOnce(
    background,
    "        goodsKeys: batch,\n        stage: singleCanonicalStageV057(active),",
    "        goodsKeys: batch,\n        stockSingleBatch: true,\n        stockBarcode: active.job.barcode,\n        stage: singleCanonicalStageV057(active),",
    "shopling_stock_hf16_batch_marker_assignment",
  );
  new Function(background);
  entries[BACKGROUND_BATCH_FILE] = strToU8(background);

  let canonical = strFromU8(canonicalBytes);
  canonical = replaceOnce(
    canonical,
    '    const singleStockBatch = /^SINGLE_(?:BATCH|SPLIT)/.test(String(assignment.stage || ""));',
    '    const singleStockBatch = assignment?.stockSingleBatch === true || /^SINGLE_(?:BATCH|SPLIT)/.test(String(assignment.stage || ""));',
    "shopling_stock_hf16_immutable_single_batch_classifier",
  );
  new Function(canonical);
  entries[CANONICAL_LIST_FILE] = strToU8(canonical);

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
    throw new Error("shopling_stock_hf16_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v058.js") {
    throw new Error("shopling_stock_hf16_hf15_checkpoint_missing");
  }

  manifest.name = "Commerce OS · Shopling Stock State Sync HF16";
  manifest.description = "HF16: isolated page channel + immutable SINGLE batch marker so deleted A6-derived goods keys stay advisory after A21 stage transitions.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF16`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  if (!background.includes("stockSingleBatch: true")) {
    throw new Error("shopling_stock_hf16_immutable_marker_missing");
  }
  if (!canonical.includes("assignment?.stockSingleBatch === true || /^SINGLE_")) {
    throw new Error("shopling_stock_hf16_classifier_marker_missing");
  }
  if (!canonical.includes('if (missing.length && !singleStockBatch) return fail(assignment.jobId, "A21_GOODSKEY_RESULT_MISSING"')) {
    throw new Error("shopling_stock_hf16_non_single_strict_guard_missing");
  }
  if (!canonical.includes("missingGoodsKeysIgnored: Boolean(singleStockBatch && missing.length)")) {
    throw new Error("shopling_stock_hf16_missing_key_evidence_missing");
  }

  for (const required of [
    "background-v055.js",
    "background-v056.js",
    "background-v057.js",
    "background-v058.js",
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v011.js",
    "content-ops-v021.js",
  ]) {
    if (!entries[required]) throw new Error(`shopling_stock_hf16_checkpoint_missing:${required}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const canonicalSha256 = createHash("sha256").update(canonical).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      pageChannel: "HF15_ISOLATED_CHANNEL_PRESERVED",
      optionFlow: "HF10_UNCHANGED",
      singleFlow: "A6_READ_ONLY_TO_A21_EXISTING_ROWS_ONLY",
      singleA4Used: false,
      singleBatchIdentity: "IMMUTABLE_stockSingleBatch_TRUE",
      mutableA21StageCanReclassifySingle: false,
      singleMissingRequestedGoodsKeys: "IGNORE_AS_DELETED_OR_STALE_EVEN_AFTER_SEARCH_SUBMITTED_RETRY",
      singleReturnedRowSafety: "EVERY_RETURNED_ROW_MUST_MATCH_A6_DERIVED_GOODSKEY",
      exactRepeatedFailurePrevented: "A21_GOODSKEY_RESULT_MISSING_NOT_APPLIED_TO_MARKED_SINGLE_BATCH",
      backgroundSha256,
      canonicalSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf16.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF15_ISOLATED_CHANNEL_PRESERVED",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-canonical-sha256": canonicalSha256,
    },
  });
}
