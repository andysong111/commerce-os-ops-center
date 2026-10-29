import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchShoplingStockHf37Worker } from "@/lib/shoplingStockHf37Patch";
import { GET as getHf36Download } from "../download-hf36/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.4";
const VERSION = "0.6.5";
const HOTFIX = "HF37_EMPTY_A4_DATE_CONTROLS_AND_TERMINAL_CLARITY";
const STOCK_WORKER = "content-shopling-v030.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf36Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[STOCK_WORKER];
  if (!manifestBytes || !workerBytes) {
    throw new Error("shopling_stock_hf37_required_entry_missing");
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
    throw new Error("shopling_stock_hf37_manifest_version_mismatch");
  }

  const worker = patchShoplingStockHf37Worker(strFromU8(workerBytes));
  new Function(worker);
  entries[STOCK_WORKER] = strToU8(worker);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF37";
  manifest.description =
    "HF37 identifies the unique empty A4 registration-date pair before search, records fail-closed diagnostics when ambiguous, and preserves all HF36 exact frame ownership guards.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF37`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf37_missing_packaged_file:${file}`);
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
        emptyA4DateControlsSupported: true,
        dateRangeStart: "20230101",
        dateRangeEnd: "TODAY_KST",
        ambiguousDateMutationAttempted: false,
        ambiguousDateDiagnosticsIncluded: true,
        hf36ExactFrameOwnershipPreserved: true,
        worker: STOCK_WORKER,
        workerSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.5-hf37.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-empty-a4-date-controls": "true",
      "x-stock-worker-sha256": workerSha256,
    },
  });
}
