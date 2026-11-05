import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf73A21ContentSource,
  patchHf73A21MainSource,
} from "@/lib/shoplingStockHf73Patch";
import { GET as getHf72Download } from "../download-hf72/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.35";
const VERSION = "0.6.36";
const HOTFIX = "HF73_MAIN_WORLD_NATIVE_OPTION_MODE_SELECTION";
const BACKGROUND = "background-v092.js";
const BASE_CONTENT = "content-a21-price-core-v054.js";
const CONTENT = "content-a21-price-core-v055.js";
const BASE_MAIN = "main-a21-price-core-v054.js";
const MAIN = "main-a21-price-core-v055.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf72Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [BACKGROUND, BASE_CONTENT, BASE_MAIN]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf73_base_file_missing:${file}`);
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf73_manifest_missing");
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
    throw new Error("shopling_stock_hf73_manifest_checkpoint_mismatch");
  }

  const content = patchHf73A21ContentSource(
    normalized(strFromU8(entries[BASE_CONTENT])),
  )
    .replaceAll(
      "commerce-os-stock-price-core-v054-main-submit-request",
      "commerce-os-stock-price-core-v055-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v054-main-submit-response",
      "commerce-os-stock-price-core-v055-main-submit-response",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v054-status",
      "commerce-os-stock-price-core-v055-status",
    );
  const main = patchHf73A21MainSource(
    normalized(strFromU8(entries[BASE_MAIN])),
  )
    .replaceAll(
      "commerce-os-stock-price-core-v054-main-submit-request",
      "commerce-os-stock-price-core-v055-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v054-main-submit-response",
      "commerce-os-stock-price-core-v055-main-submit-response",
    );

  for (const source of [content, main]) new Function(source);
  entries[CONTENT] = strToU8(content);
  entries[MAIN] = strToU8(main);
  delete entries[BASE_CONTENT];
  delete entries[BASE_MAIN];

  const contentEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CONTENT),
  );
  const mainEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_MAIN),
  );
  if (!contentEntry || !mainEntry) {
    throw new Error("shopling_stock_hf73_worker_entry_missing");
  }
  contentEntry.js = contentEntry.js.map((file) =>
    file === BASE_CONTENT ? CONTENT : file,
  );
  mainEntry.js = mainEntry.js.map((file) =>
    file === BASE_MAIN ? MAIN : file,
  );

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF73";
  manifest.description =
    "HF73 keeps HF72 grouped goods-key dispatch, then selects and reads back the exact Shopling option-mode and option-only radios in the page main world before one guarded submit.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF73`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["content", content, 'mainSubmit("OPTION", "PREPARE")'],
    ["content", content, "MAIN_WORLD_NATIVE_OPTION_SELECTION"],
    ["content", content, "V029_MAIN_OPTION_PREPARE_NOT_VISIBLE"],
    ["content", content, "JSON.stringify({ nonce, mode, phase })"],
    ["main", main, "exactSemanticOptionControls"],
    ["main", main, "HTMLInputElement.prototype.click.call(target)"],
    ["main", main, "prepareExactOptionSelection"],
    ["main", main, 'phase === "PREPARE"'],
    ["main", main, "v029_option_selection_readback_failed"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf73_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf73_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({ content, main }).map(([key, source]) => [
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
        goodsKeyDispatch: "GROUPED_BY_TRANSMISSION_KIND_UP_TO_200",
        optionModeSelection:
          "EXACT_SEMANTIC_RADIOS_SELECTED_AND_READ_BACK_IN_SHOPLING_MAIN_WORLD",
        submitCardinality: "ONE_PER_COMPATIBLE_GOODS_KEY_GROUP",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.36-hf73.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-goods-key-dispatch": "grouped-by-compatible-mode-up-to-200",
      "x-stock-option-selection": "shopling-main-world-native-click-and-readback",
      "x-stock-content-sha256": String(hashes.contentSha256),
      "x-stock-main-sha256": String(hashes.mainSha256),
    },
  });
}
