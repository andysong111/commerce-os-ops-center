import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf31Download } from "../download-hf31/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.5.9";
const VERSION = "0.6.0";
const HOTFIX = "HF32_WAREHOUSE_MAP_STOCK_COMMAND";
const WAREHOUSE_MATCH = "https://storage-organization.vercel.app/*";
const OPS_BRIDGE = "content-ops-v021.js";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf31Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;
  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const bridgeBytes = entries[OPS_BRIDGE];
  if (!manifestBytes || !bridgeBytes) {
    throw new Error("shopling_stock_hf32_required_entry_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    version: string;
    name?: string;
    description?: string;
    host_permissions: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ matches: string[]; js: string[] }>;
  };
  if (manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf32_manifest_version_mismatch");
  }
  const bridgeScript = manifest.content_scripts.find((script) =>
    script.js.includes(OPS_BRIDGE),
  );
  if (!bridgeScript?.matches.includes("https://commerce-os-ops-center.vercel.app/*")) {
    throw new Error("shopling_stock_hf32_ops_bridge_missing");
  }
  if (!manifest.host_permissions.includes(WAREHOUSE_MATCH)) {
    manifest.host_permissions.push(WAREHOUSE_MATCH);
  }
  if (!bridgeScript.matches.includes(WAREHOUSE_MATCH)) {
    bridgeScript.matches.push(WAREHOUSE_MATCH);
  }
  let bridge = strFromU8(bridgeBytes);
  bridge = replaceOnce(
    bridge,
    '  const OPTION_API_PATH = "/api/inventory-stock-control/shopling-option-status";',
    `  const WAREHOUSE_HOST = location.hostname === "storage-organization.vercel.app";
  const OPTION_API_PATH = WAREHOUSE_HOST ? "/api/warehouse-stock-state" : "/api/inventory-stock-control/shopling-option-status";`,
    "shopling_stock_hf32_proxy_path",
  );
  bridge = replaceOnce(
    bridge,
    `      body: JSON.stringify({
        jobId: job?.jobId || "",
        barcode: job?.barcode || "",
        desiredStatus: job?.desiredStatus || "",
        goodsKeys: [goodsKey],
      }),`,
    `      body: JSON.stringify({
        ...(WAREHOUSE_HOST ? { action: "apply_option_status", commandToken: job?.warehouseCommandToken || "" } : {}),
        jobId: job?.jobId || "",
        barcode: job?.barcode || "",
        desiredStatus: job?.desiredStatus || "",
        goodsKeys: [goodsKey],
      }),`,
    "shopling_stock_hf32_proxy_token",
  );
  new Function(bridge);
  entries[OPS_BRIDGE] = strToU8(bridge);
  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF32";
  manifest.description =
    "HF32 connects signed warehouse-map commands to the existing exact B-code Shopling worker while preserving every HF31 all-date and readback guard.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF32`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf32_missing_file:${file}`);
  }
  const zip = zipSync(entries, { level: 9 });
  const bridgeSha256 = createHash("sha256").update(bridge).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        warehouseOrigin: WAREHOUSE_MATCH,
        warehouseOptionApiProxy: "/api/warehouse-stock-state",
        signedCommandTokenRequired: true,
        bridgeSha256,
        hf31AllDateAndExactBcodeGuardsPreserved: true,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.0-hf32.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-warehouse-bridge-sha256": bridgeSha256,
    },
  });
}
