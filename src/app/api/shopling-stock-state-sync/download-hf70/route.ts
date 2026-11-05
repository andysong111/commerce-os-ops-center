import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf70A21ContentSource,
  patchHf70A21MainSource,
  patchHf70OptionClaimSource,
  patchHf70OptionListSource,
  patchHf70SingleClaimSource,
  patchHf70SingleListSource,
} from "@/lib/shoplingStockHf70Patch";
import { GET as getHf69Download } from "../download-hf69/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.32";
const VERSION = "0.6.33";
const HOTFIX = "HF70_EXACT_A21_POPUP_OWNER_AND_CELL_LOCAL_RADIO";
const BASE_BACKGROUND = "background-v089.js";
const BACKGROUND = "background-v090.js";
const OPTION_CLAIM = "background-v050.js";
const OPTION_LIST = "background-v053.js";
const SINGLE_LIST = "background-v056.js";
const SINGLE_CLAIM = "background-v059.js";
const BASE_CONTENT = "content-a21-price-core-v052.js";
const CONTENT = "content-a21-price-core-v053.js";
const BASE_MAIN = "main-a21-price-core-v052.js";
const MAIN = "main-a21-price-core-v053.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf69Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [
    BASE_BACKGROUND,
    OPTION_CLAIM,
    OPTION_LIST,
    SINGLE_LIST,
    SINGLE_CLAIM,
    BASE_CONTENT,
    BASE_MAIN,
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf70_base_file_missing:${file}`);
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf70_manifest_missing");
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
    throw new Error("shopling_stock_hf70_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, optionClaim, optionList, singleList, singleClaim] =
    await Promise.all([
      readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
      Promise.resolve(strFromU8(entries[OPTION_CLAIM])).then(normalized).then(patchHf70OptionClaimSource),
      Promise.resolve(strFromU8(entries[OPTION_LIST])).then(normalized).then(patchHf70OptionListSource),
      Promise.resolve(strFromU8(entries[SINGLE_LIST])).then(normalized).then(patchHf70SingleListSource),
      Promise.resolve(strFromU8(entries[SINGLE_CLAIM])).then(normalized).then(patchHf70SingleClaimSource),
    ]);
  const content = patchHf70A21ContentSource(normalized(strFromU8(entries[BASE_CONTENT])))
    .replaceAll(
      "commerce-os-stock-price-core-v052-main-submit-request",
      "commerce-os-stock-price-core-v053-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v052-main-submit-response",
      "commerce-os-stock-price-core-v053-main-submit-response",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v052-status",
      "commerce-os-stock-price-core-v053-status",
    );
  const main = patchHf70A21MainSource(normalized(strFromU8(entries[BASE_MAIN])))
    .replaceAll(
      "commerce-os-stock-price-core-v052-main-submit-request",
      "commerce-os-stock-price-core-v053-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v052-main-submit-response",
      "commerce-os-stock-price-core-v053-main-submit-response",
    );

  for (const source of [
    background,
    optionClaim,
    optionList,
    singleList,
    singleClaim,
    content,
    main,
  ]) {
    new Function(source);
  }

  entries[BACKGROUND] = strToU8(background);
  entries[OPTION_CLAIM] = strToU8(optionClaim);
  entries[OPTION_LIST] = strToU8(optionList);
  entries[SINGLE_LIST] = strToU8(singleList);
  entries[SINGLE_CLAIM] = strToU8(singleClaim);
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
    throw new Error("shopling_stock_hf70_worker_entry_missing");
  }
  contentEntry.js = contentEntry.js.map((file) =>
    file === BASE_CONTENT ? CONTENT : file,
  );
  mainEntry.js = mainEntry.js.map((file) =>
    file === BASE_MAIN ? MAIN : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF70";
  manifest.description =
    "HF70 binds every A21 transmission to the fresh popup opened by the exact current list tab and selects the option mode only from its own cell, never from the shared top row.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF70`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v089.js")'],
    ["optionClaim", optionClaim, "stock_price_core_popup_owner_mismatch_hf70"],
    ["optionClaim", optionClaim, "exactFreshOwnedPopupV070"],
    ["optionList", optionList, "a21PopupBaselineTabIds"],
    ["optionList", optionList, "Number(tab.openerTabId) === expectedListTabId"],
    ["singleList", singleList, "singleA21PopupBaselineTabIds"],
    ["singleClaim", singleClaim, "stock_single_popup_owner_mismatch_hf70"],
    ["content", content, "exactOptionModeOwner"],
    ["content", content, "candidates.length === 1 ? candidates[0] : null"],
    ["main", main, 'compact(node.textContent) === "옵션송신"'],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf70_guard_missing:${label}:${guard}`);
    }
  }
  if (content.includes('control?.closest?.("tr")')) {
    throw new Error("shopling_stock_hf70_content_shared_row_radio_regression");
  }
  if (main.includes('control?.closest?.("tr")')) {
    throw new Error("shopling_stock_hf70_main_shared_row_radio_regression");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf70_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({
      background,
      optionClaim,
      optionList,
      singleList,
      singleClaim,
      content,
      main,
    }).map(([key, source]) => [
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
        popupOwnership: "FRESH_TAB_NOT_IN_BASELINE_AND_EXACT_A21_LIST_OPENER",
        optionModeLocator: "UNIQUE_EXACT_CELL_OWNER_NO_SHARED_ROW_TEXT",
        goodsKeyDispatch: "SERIAL_ONE_AT_A_TIME",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.33-hf70.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-ownership": "fresh-exact-a21-list-opener",
      "x-stock-radio-locator": "unique-exact-cell-owner",
      "x-stock-background-sha256": String(hashes.backgroundSha256),
      "x-stock-content-sha256": String(hashes.contentSha256),
      "x-stock-main-sha256": String(hashes.mainSha256),
    },
  });
}
