import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchShoplingStockHf46OptionBatch } from "@/lib/shoplingStockHf46Patch";
import { GET as getHf42Download } from "../download-hf42/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.10";
const VERSION = "0.6.11";
const HOTFIX = "HF46_OPTION_A21_CANONICAL_WORKER_READY";
const OPTION_BATCH = "background-v071.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf42Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const optionBatchBytes = entries[OPTION_BATCH];
  if (!manifestBytes || !optionBatchBytes) {
    throw new Error("shopling_stock_hf46_required_entry_missing");
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
    throw new Error("shopling_stock_hf46_manifest_version_mismatch");
  }

  const optionBatch = patchShoplingStockHf46OptionBatch(
    strFromU8(optionBatchBytes),
  );
  new Function(optionBatch);
  for (const guard of [
    "const deadlineHf46 = Date.now() + 8_000",
    "if (!injectedHf46)",
    "await sleep(250)",
    'active.job?.productKind === "OPTION"',
    'active.job?.optionApiApplied === true',
  ]) {
    if (!optionBatch.includes(guard)) {
      throw new Error(`shopling_stock_hf46_option_guard_missing:${guard}`);
    }
  }
  if (optionBatch.includes("await sleep(140)")) {
    throw new Error("shopling_stock_hf46_short_option_wait_present");
  }
  entries[OPTION_BATCH] = strToU8(optionBatch);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF46";
  manifest.description =
    "HF46 waits up to eight seconds for the exact OPTION A21 canonical worker and injects it at most once before assignment. This closes the fresh-page readiness race without repeating the already verified option API mutation or sending an uncertain A21 command.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF46`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    OPTION_BATCH,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf46_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const optionBatchSha256 = createHash("sha256")
    .update(optionBatch)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        optionCanonicalWorkerWaitMs: 8_000,
        optionCanonicalWorkerInjectedAtMostOnce: true,
        optionApiMutationRepeatedBeforeAssignment: false,
        uncertainA21AssignmentSent: false,
        incidentRegression:
          "BDE7-3_OPTION_API_SUCCEEDED_THEN_FRESH_A21_WORKER_MISSED_AFTER_140MS",
        optionBatch: OPTION_BATCH,
        optionBatchSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.11-hf46.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-option-worker-wait-ms": "8000",
      "x-stock-option-batch-sha256": optionBatchSha256,
    },
  });
}
