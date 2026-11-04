import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf65Download } from "../download-hf65/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.28";
const VERSION = "0.6.29";
const HOTFIX = "HF66_RESTORE_HF27_PAGE_CHANNEL";
const BACKGROUND = "background-v087.js";
const BASE_OPS = "content-ops-v022.js";
const OPS = "content-ops-v023.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf65Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BACKGROUND] || !entries[BASE_OPS]) {
    throw new Error("shopling_stock_hf66_base_package_missing");
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
    manifest.background.service_worker !== BACKGROUND
  ) {
    throw new Error("shopling_stock_hf66_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const ops = await readFile(path.join(root, OPS), "utf8").then(normalized);
  new Function(ops);
  entries[OPS] = strToU8(ops);
  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_OPS),
  );
  if (!opsEntry) throw new Error("shopling_stock_hf66_ops_entry_missing");
  opsEntry.js = opsEntry.js.map((file) => (file === BASE_OPS ? OPS : file));

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF66";
  manifest.description =
    "HF66 preserves HF65 API-first B-code status verification and A21-only marketplace transmission while restoring the HF27-isolated Commerce OS page channel.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF66`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27"',
    'const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27"',
    'const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27"',
    'const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27"',
    'stockSyncChannel: "HF27"',
    "stockStateApiApplied: true",
  ]) {
    if (!ops.includes(guard)) {
      throw new Error(`shopling_stock_hf66_channel_guard_missing:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf66_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const opsSha256 = createHash("sha256").update(ops).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause: "HF65_REPLACED_HF27_TRANSFORMED_OPS_WITH_LEGACY_CHANNEL_SOURCE",
        pageChannel: "HF27_ONLY",
        shoplingMutation: "API_ONLY",
        readback: "API_STATUS_AND_QUANTITY",
        browserStages: ["A21_LIST", "A21_PROCESSING_OR_RESULT"],
        marketplaceCompletionRequired: false,
        opsSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.29-hf66.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-page-channel": "HF27_ONLY",
      "x-stock-api-first": "true",
      "x-stock-ops-sha256": opsSha256,
    },
  });
}
