import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf12Download } from "../download-hf12/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.5";
const HOTFIX = "HF13_SINGLE_A6_READONLY_TO_A21_BATCH_SALE_STATUS_NO_A4";
const BACKGROUND_FILE = "background-v057.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const hf12Response = await getHf12Download(new Request(baseUrl.toString(), { headers: request.headers }));
  if (!hf12Response.ok) return hf12Response;

  const entries = unzipSync(new Uint8Array(await hf12Response.arrayBuffer()));
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_FILE), "utf8");
  new Function(background);
  entries[BACKGROUND_FILE] = strToU8(background);

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf13_manifest_missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== VERSION) {
    throw new Error("shopling_stock_hf13_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== "background-v056.js") {
    throw new Error("shopling_stock_hf13_hf11_background_checkpoint_missing");
  }
  for (const checkpoint of [
    "background-v055.js",
    "background-v056.js",
    "content-a21-canonical-v014.js",
    "content-stock-single-popup-v011.js",
    "content-shopling-v030.js",
  ]) {
    if (!entries[checkpoint]) throw new Error(`shopling_stock_hf13_checkpoint_missing:${checkpoint}`);
  }

  manifest.background.service_worker = BACKGROUND_FILE;
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF13`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards = [
    'importScripts("background-v056.js")',
    'productKind === "SINGLE" ? ["A6", "A21_LIST"]',
    'singleA4Bypassed: true',
    'goodsKeySource: "A6_LIVE_SINGLE_BARCODE"',
    'const SINGLE_BATCH_MAX = 200',
    'goodsKeys: batch',
    'mode: "OPTION"',
    'SINGLE_A21_BATCH_ADAPTIVE_SPLIT',
    'active.stage = "A21_LIST"',
  ];
  for (const guard of guards) {
    if (!background.includes(guard)) throw new Error(`shopling_stock_hf13_guard_missing:${guard}`);
  }
  if (background.includes('stage: "A4"') || background.includes('preflight.targets.A4')) {
    throw new Error("shopling_stock_hf13_single_a4_reference_forbidden");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf13_missing_packaged_file:${file}`);
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true,
      version: VERSION,
      hotfix: HOTFIX,
      zipBytes: zip.byteLength,
      hf10OptionCheckpointPreserved: true,
      hf11SinglePopupCheckpointPreserved: true,
      hf12PackagedWorkerCheckpointPreserved: true,
      optionFlow: "HF10_UNCHANGED",
      singleFlow: "A6_READ_ONLY_BCODE_RESOLVE_THEN_A21_PRODUCT_SALE_STATUS",
      singleA4Used: false,
      singleA6Mutation: false,
      singleA6Purpose: "LIVE_GOODSKEY_RESOLVER_ONLY",
      singleA21ListEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      singleGoodsKeyBatchMax: 200,
      singleA21VisibleRowLimit: 500,
      singleAdaptiveSplitWhenOverVisibleLimit: true,
      singlePopupMode: "상품판매상태송신_ONLY",
      singleStatusMapping: { SOLD_OUT: "품절", ON_SALE: "판매중" },
      singleLargeSetExecution: "SAFE_SERIAL_BATCHES_AFTER_A6_CANARY",
      parallelLargeSetWindows: false,
      backgroundAdapter: BACKGROUND_FILE,
      backgroundSha256,
      liveSingleShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf13.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
