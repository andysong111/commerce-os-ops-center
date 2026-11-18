import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf96 } from "@/app/api/shopling-stock-state-sync/download-hf96/route";
import { patchHf99EndedProductSkip } from "@/lib/shoplingStockHf99Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.58";
const VERSION = "0.6.59";
const HOTFIX = "HF99_ENDED_PRODUCT_SKIP";
const OPS_SCRIPT = "content-ops-v025.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf96(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf96",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf99_base_download_failed");
  }

  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const opsBytes = entries[OPS_SCRIPT];
  if (!manifestBytes || !opsBytes) {
    throw new Error("shopling_stock_hf99_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[]; matches: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf99_manifest_checkpoint_mismatch");
  }

  const ops = normalized(patchHf99EndedProductSkip(strFromU8(opsBytes)));
  new Function(ops);
  entries[OPS_SCRIPT] = strToU8(ops);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF99";
  manifest.description =
    "HF99 excludes Shopling ended products (E) from both on-sale and sold-out transmissions while continuing every remaining goods key serially.";
  manifest.action.default_title =
    `Shopling 판매종료 제외 처리 v${VERSION} HF99`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf99_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    patchedOpsSha256: createHash("sha256").update(ops).digest("hex"),
    baseZipSha256: createHash("sha256").update(baseZip).digest("hex"),
  };

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        endedProductPolicy:
          "SKIP_E_FOR_ON_SALE_AND_SOLD_OUT_CONTINUE_REMAINING_GOODS_KEYS",
        endedOnlyPolicy: "SUCCEED_WITHOUT_A21_TRANSMISSION",
        serialDispatchPolicy: "ONE_BCODE_AT_A_TIME_UNCHANGED",
        ...hashes,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.59-hf99.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-ended-product": "excluded-without-transmission",
      "x-stock-patched-ops-sha256": hashes.patchedOpsSha256,
    },
  });
}
