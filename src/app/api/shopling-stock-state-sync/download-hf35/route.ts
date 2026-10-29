import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf35Worker,
  SHOPLING_A6_REGISTRATION_START_HF35,
} from "@/lib/shoplingStockHf35Patch";
import { GET as getHf34Download } from "../download-hf34/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.2";
const VERSION = "0.6.3";
const HOTFIX = "HF35_A6_2023_RANGE_AND_PRODUCT_ROWS_ONLY";
const STOCK_WORKER = "content-shopling-v030.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf34Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[STOCK_WORKER];
  if (!manifestBytes || !workerBytes) {
    throw new Error("shopling_stock_hf35_required_entry_missing");
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
    throw new Error("shopling_stock_hf35_manifest_version_mismatch");
  }

  const worker = patchShoplingStockHf35Worker(strFromU8(workerBytes));
  if (worker.includes('const START = "20130912"') || worker.includes('start: "20220101"')) {
    throw new Error("shopling_stock_hf35_conflicting_date_policy_present");
  }
  if (!worker.includes("Boolean(resultCheckbox) && Boolean(identity) && barcodeRegex.test")) {
    throw new Error("shopling_stock_hf35_product_row_guard_missing");
  }
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF35";
  manifest.description =
    "HF35 uses one 2023-01-01 through today A6 search range and counts only exact B-code rows with a Shopling goods/option identity, excluding the search-condition row.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF35`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf35_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a6RegistrationDateStart: SHOPLING_A6_REGISTRATION_START_HF35,
        a6RegistrationDateEnd: "TODAY_KST",
        a6SearchDatePolicy: "ONE_CANONICAL_RANGE",
        a6ResultRowsRequireCheckboxAndGoodsOptionIdentity: true,
        a6SearchConditionRowExcluded: true,
        incidentRegression: "BCB6-2_TOTAL_8_PLUS_SEARCH_ROW_MUST_EQUAL_8",
        hf34BackgroundDateControlsPreserved: true,
        liveShoplingVerificationRequired: true,
        worker: STOCK_WORKER,
        workerSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf35.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a6-registration-date-start": SHOPLING_A6_REGISTRATION_START_HF35,
      "x-stock-worker-sha256": workerSha256,
    },
  });
}
