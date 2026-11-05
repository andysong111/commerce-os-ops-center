import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf71A21ContentSource,
  patchHf71A21MainSource,
} from "@/lib/shoplingStockHf71Patch";
import { GET as getHf70Download } from "../download-hf70/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.33";
const VERSION = "0.6.34";
const HOTFIX = "HF71_A21_INLINE_LABEL_GEOMETRY_AND_BOUNDED_DIAGNOSTICS";
const BASE_BACKGROUND = "background-v090.js";
const BACKGROUND = "background-v091.js";
const BASE_CONTENT = "content-a21-price-core-v053.js";
const CONTENT = "content-a21-price-core-v054.js";
const BASE_MAIN = "main-a21-price-core-v053.js";
const MAIN = "main-a21-price-core-v054.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf70Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [BASE_BACKGROUND, BASE_CONTENT, BASE_MAIN]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf71_base_file_missing:${file}`);
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf71_manifest_missing");
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
    throw new Error("shopling_stock_hf71_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(await readFile(path.join(root, BACKGROUND), "utf8"));
  const content = patchHf71A21ContentSource(normalized(strFromU8(entries[BASE_CONTENT])))
    .replaceAll(
      "commerce-os-stock-price-core-v053-main-submit-request",
      "commerce-os-stock-price-core-v054-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v053-main-submit-response",
      "commerce-os-stock-price-core-v054-main-submit-response",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v053-status",
      "commerce-os-stock-price-core-v054-status",
    );
  const main = patchHf71A21MainSource(normalized(strFromU8(entries[BASE_MAIN])))
    .replaceAll(
      "commerce-os-stock-price-core-v053-main-submit-request",
      "commerce-os-stock-price-core-v054-main-submit-request",
    )
    .replaceAll(
      "commerce-os-stock-price-core-v053-main-submit-response",
      "commerce-os-stock-price-core-v054-main-submit-response",
    );

  for (const source of [background, content, main]) new Function(source);

  entries[BACKGROUND] = strToU8(background);
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
    throw new Error("shopling_stock_hf71_worker_entry_missing");
  }
  contentEntry.js = contentEntry.js.map((file) =>
    file === BASE_CONTENT ? CONTENT : file,
  );
  mainEntry.js = mainEntry.js.map((file) =>
    file === BASE_MAIN ? MAIN : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF71";
  manifest.description =
    "HF71 identifies the A21 top transmission mode from its exact adjacent label first, then the proven three-column geometry, and reports bounded radio evidence on any fail-closed mismatch.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF71`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v090.js")'],
    ["content", content, "exactInlineModeTexts"],
    ["content", content, "chooseOptionModeSnapshot"],
    ["content", content, "라디오 진단="],
    ["content", content, "topRow.length !== 3"],
    ["main", main, "exactInlineModeTexts"],
    ["main", main, "topRow[2].control === control"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf71_guard_missing:${label}:${guard}`);
    }
  }
  if (content.includes('control?.closest?.("tr")')) {
    throw new Error("shopling_stock_hf71_content_shared_row_radio_regression");
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf71_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({ background, content, main }).map(([key, source]) => [
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
        optionModeLocator: "EXACT_ADJACENT_LABEL_THEN_GUARDED_THREE_COLUMN_GEOMETRY",
        diagnostic: "BOUNDED_NAME_VALUE_CELL_TEXT_AND_CHECKED_STATE",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.34-hf71.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-radio-locator": "exact-inline-label-then-three-column-geometry",
      "x-stock-background-sha256": String(hashes.backgroundSha256),
      "x-stock-content-sha256": String(hashes.contentSha256),
      "x-stock-main-sha256": String(hashes.mainSha256),
    },
  });
}
