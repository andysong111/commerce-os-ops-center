import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf39Coordinator,
  patchShoplingStockHf39SingleBatch,
} from "@/lib/shoplingStockHf39Patch";
import { GET as getHf38Download } from "../download-hf38/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.6";
const VERSION = "0.6.7";
const HOTFIX = "HF39_A4_A21_EXACT_ROLE_AND_WORKER_READY";
const COORDINATOR = "background-v030.js";
const SINGLE_BATCH = "background-v057.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf38Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const coordinatorBytes = entries[COORDINATOR];
  const singleBatchBytes = entries[SINGLE_BATCH];
  if (!manifestBytes || !coordinatorBytes || !singleBatchBytes) {
    throw new Error("shopling_stock_hf39_required_entry_missing");
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
    throw new Error("shopling_stock_hf39_manifest_version_mismatch");
  }

  const coordinator = patchShoplingStockHf39Coordinator(
    strFromU8(coordinatorBytes),
  );
  const singleBatch = patchShoplingStockHf39SingleBatch(
    strFromU8(singleBatchBytes),
  );
  new Function(coordinator);
  new Function(singleBatch);

  for (const guard of [
    'path === "/prod/prodlst.phtml"',
    '/쇼핑몰상품수정/i.test(text) && /상품\\s*수정전송/i.test(text)',
    "HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER",
  ]) {
    if (!coordinator.includes(guard)) {
      throw new Error(`shopling_stock_hf39_role_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "const deadlineHf39 = Date.now() + 8_000",
    "if (!injectedHf39)",
    "await sleep(250)",
  ]) {
    if (!singleBatch.includes(guard)) {
      throw new Error(`shopling_stock_hf39_worker_guard_missing:${guard}`);
    }
  }
  entries[COORDINATOR] = strToU8(coordinator);
  entries[SINGLE_BATCH] = strToU8(singleBatch);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF39";
  manifest.description =
    "HF39 rejects A4 launchers that merely contain the A21 menu label and waits for the exact A21 list worker before dispatch. No product mutation occurs while role or worker readiness is uncertain.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF39`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    COORDINATOR,
    SINGLE_BATCH,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf39_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const coordinatorSha256 = createHash("sha256")
    .update(coordinator)
    .digest("hex");
  const singleBatchSha256 = createHash("sha256")
    .update(singleBatch)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a4LauncherCannotMasqueradeAsA21: true,
        exactA21TextRequired: true,
        canonicalWorkerWaitMs: 8_000,
        canonicalWorkerInjectedAtMostOnce: true,
        incidentRegression:
          "BBB4-3_A6_RESOLVED_12_GOODS_KEYS_THEN_FALSE_A21_A4_LAUNCHER_DISPATCH_FAILED",
        hf38FreshOwnedPopupGuardsPreserved: true,
        mutationBeforeExactA21Ready: false,
        coordinator: COORDINATOR,
        coordinatorSha256,
        singleBatch: SINGLE_BATCH,
        singleBatchSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.7-hf39.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-exact-a21-role": "true",
      "x-stock-coordinator-sha256": coordinatorSha256,
      "x-stock-single-batch-sha256": singleBatchSha256,
    },
  });
}
