import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf69A21ContentSource,
  patchHf69A21MainSource,
  patchHf69OpsSource,
} from "@/lib/shoplingStockHf69Patch";
import { GET as getHf68Download } from "../download-hf68/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.31";
const VERSION = "0.6.32";
const HOTFIX = "HF69_PER_GOODS_KEY_SHAPE_AND_PROVEN_RADIO_CLICK";
const BASE_BACKGROUND = "background-v088.js";
const BACKGROUND = "background-v089.js";
const BASE_OPS = "content-ops-v023.js";
const OPS = "content-ops-v024.js";
const BASE_CONTENT = "content-a21-price-core-v051.js";
const CONTENT = "content-a21-price-core-v052.js";
const BASE_MAIN = "main-a21-price-core-v051.js";
const MAIN = "main-a21-price-core-v052.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf68Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (
    !manifestBytes ||
    !entries[BASE_BACKGROUND] ||
    !entries[BASE_OPS] ||
    !entries[BASE_CONTENT] ||
    !entries[BASE_MAIN]
  ) {
    throw new Error("shopling_stock_hf69_base_package_missing");
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
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf69_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, opsBase, contentBase, mainBase] = await Promise.all([
    readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
    Promise.resolve(strFromU8(entries[BASE_OPS])).then(normalized),
    Promise.resolve(strFromU8(entries[BASE_CONTENT])).then(normalized),
    Promise.resolve(strFromU8(entries[BASE_MAIN])).then(normalized),
  ]);
  const ops = patchHf69OpsSource(opsBase);
  const content = patchHf69A21ContentSource(contentBase)
    .replaceAll(
      "commerce-os-stock-price-core-v051-main-submit-request",
      "commerce-os-stock-price-core-v052-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v051-main-submit-response",
      "commerce-os-stock-price-core-v052-main-submit-response",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v051-status",
      "commerce-os-stock-price-core-v052-status",
    );
  const main = patchHf69A21MainSource(mainBase)
    .replaceAll(
      "commerce-os-stock-price-core-v051-main-submit-request",
      "commerce-os-stock-price-core-v052-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v051-main-submit-response",
      "commerce-os-stock-price-core-v052-main-submit-response",
    );
  for (const source of [background, ops, content, main]) new Function(source);

  entries[BACKGROUND] = strToU8(background);
  entries[OPS] = strToU8(ops);
  entries[CONTENT] = strToU8(content);
  entries[MAIN] = strToU8(main);
  delete entries[BASE_OPS];
  delete entries[BASE_CONTENT];
  delete entries[BASE_MAIN];

  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_OPS),
  );
  const contentEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CONTENT),
  );
  const mainEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_MAIN),
  );
  if (!opsEntry || !contentEntry || !mainEntry) {
    throw new Error("shopling_stock_hf69_worker_entry_missing");
  }
  opsEntry.js = opsEntry.js.map((file) => (file === BASE_OPS ? OPS : file));
  contentEntry.js = contentEntry.js.map((file) =>
    file === BASE_CONTENT ? CONTENT : file,
  );
  mainEntry.js = mainEntry.js.map((file) =>
    file === BASE_MAIN ? MAIN : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF69";
  manifest.description =
    "HF69 classifies every goods key by its live option count, routes one-option split listings through product sale-status transmission, and restores the proven visible top-to-bottom A21 radio click path.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF69`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'importScripts("background-v088.js")',
    "stockStateTransmissions",
    "PRODUCT_SALE_STATUS_SEND",
    "optionApiApplied = false",
    "serialPerGoodsKey: true",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf69_background_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "SHOPLING_BCODE_API_INDEX_AND_LIVE_OPTION_SHAPE",
    "stockStateTransmissions: transmissions",
    "optionApiApplied: false",
  ]) {
    if (!ops.includes(guard)) {
      throw new Error(`shopling_stock_hf69_ops_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "VISIBLE_TOP_MODE_THEN_OPTION_ONLY_ROW",
    "isVisibleOptionModeEvidence",
    "configureOptionByVisibleLabels()",
  ]) {
    if (!content.includes(guard)) {
      throw new Error(`shopling_stock_hf69_content_guard_missing:${guard}`);
    }
  }
  if (!main.includes("control?.closest?.(\"tr\")")) {
    throw new Error("shopling_stock_hf69_main_visible_readback_missing");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf69_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({ background, ops, content, main }).map(([key, source]) => [
      `${key}Sha256`,
      createHash("sha256").update(source).digest("hex"),
    ]),
  );
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        goodsKeyClassification: "LIVE_OPTION_COUNT_PER_GOODS_KEY",
        singleOptionLogicalOptionRoute:
          "EXACT_OPTION_API_PLUS_PRODUCT_STATUS_API_THEN_A21_PRODUCT_SALE_STATUS",
        multiOptionRoute: "EXACT_OPTION_API_THEN_A21_OPTION_SEND",
        goodsKeyDispatch: "SERIAL_ONE_AT_A_TIME",
        optionPopupLocator: "VISIBLE_TOP_MODE_THEN_OPTION_ONLY_ROW",
        marketplaceCompletionRequired: false,
        liveShoplingVerificationRequired: true,
        ...hashes,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.32-hf69.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-goods-key-routing": "live-option-count",
      "x-stock-dispatch": "serial-one-goods-key",
      "x-stock-background-sha256": String(hashes.backgroundSha256),
      "x-stock-ops-sha256": String(hashes.opsSha256),
      "x-stock-content-sha256": String(hashes.contentSha256),
      "x-stock-main-sha256": String(hashes.mainSha256),
    },
  });
}

