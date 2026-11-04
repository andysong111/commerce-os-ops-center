import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf67Download } from "../download-hf67/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.30";
const VERSION = "0.6.31";
const HOTFIX = "HF68_A21_OPTION_VISIBLE_LABEL_FALLBACK";
const BACKGROUND = "background-v088.js";
const PREFLIGHT = "content-ops-preflight-v003.js";
const BASE_CONTENT = "content-a21-price-core-v050.js";
const CONTENT = "content-a21-price-core-v051.js";
const BASE_MAIN = "main-a21-price-core-v050.js";
const MAIN = "main-a21-price-core-v051.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf67Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (
    !manifestBytes ||
    !entries[BACKGROUND] ||
    !entries[PREFLIGHT] ||
    !entries[BASE_CONTENT] ||
    !entries[BASE_MAIN]
  ) {
    throw new Error("shopling_stock_hf68_base_package_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[] }>;
    host_permissions?: string[];
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BACKGROUND
  ) {
    throw new Error("shopling_stock_hf68_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [contentSource, mainSource] = await Promise.all([
    readFile(path.join(root, "price-core-content-a21-v025.js"), "utf8").then(normalized),
    readFile(path.join(root, "price-core-main-a21-v025.js"), "utf8").then(normalized),
  ]);
  const content = contentSource
    .replaceAll("commerce-os-a21-v025-main-submit-request", "commerce-os-stock-price-core-v051-main-submit-request")
    .replaceAll("commerce-os-a21-v025-main-submit-response", "commerce-os-stock-price-core-v051-main-submit-response")
    .replaceAll("commerce-os-a21-v025-status", "commerce-os-stock-price-core-v051-status");
  const main = mainSource
    .replaceAll("commerce-os-a21-v025-main-submit-request", "commerce-os-stock-price-core-v051-main-submit-request")
    .replaceAll("commerce-os-a21-v025-main-submit-response", "commerce-os-stock-price-core-v051-main-submit-response");
  new Function(content);
  new Function(main);
  entries[CONTENT] = strToU8(content);
  entries[MAIN] = strToU8(main);
  delete entries[BASE_CONTENT];
  delete entries[BASE_MAIN];

  const contentEntry = manifest.content_scripts.find((script) => script.js.includes(BASE_CONTENT));
  const mainEntry = manifest.content_scripts.find((script) => script.js.includes(BASE_MAIN));
  if (!contentEntry || !mainEntry) {
    throw new Error("shopling_stock_hf68_a21_worker_entry_missing");
  }
  contentEntry.js = contentEntry.js.map((file) => file === BASE_CONTENT ? CONTENT : file);
  mainEntry.js = mainEntry.js.map((file) => file === BASE_MAIN ? MAIN : file);

  const requiredHostPermissions = [
    "https://a.shopling.co.kr/*",
    "https://kt.shopling.co.kr/*",
  ];
  for (const permission of requiredHostPermissions) {
    if (!manifest.host_permissions?.includes(permission) &&
        !manifest.host_permissions?.includes("https://*.shopling.co.kr/*")) {
      throw new Error(`shopling_stock_hf68_host_permission_missing:${permission}`);
    }
  }

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF68";
  manifest.description =
    "HF68 keeps the exact A21 form contract first, then locates the current visible top option mode and the lower option-only selection by exact Korean labels before submission.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 동기화 v${VERSION} HF68`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    'const OPTION_MODE_MARKER = "data-commerce-os-option-mode"',
    'const OPTION_FIELD_MARKER = "data-commerce-os-option-field"',
    'compact(text) === "옵션송신" && controlCount === 1',
    'labels.includes("옵션송신")',
    'labels.includes("선택")',
    'text.includes("추가상품송신")',
    'text.includes("옵션+추가상품송신")',
    'locator: "FORM_CONTRACT"',
    'locator: "EXACT_VISIBLE_LABELS"',
  ]) {
    if (!content.includes(guard)) {
      throw new Error(`shopling_stock_hf68_content_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'const OPTION_MODE_MARKER = "data-commerce-os-option-mode"',
    'semanticModeMatches(mode)',
    'semanticFieldMatches(field)',
    'forbiddenOptionSelected()',
    'locator: "EXACT_VISIBLE_LABELS"',
  ]) {
    if (!main.includes(guard)) {
      throw new Error(`shopling_stock_hf68_main_guard_missing:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf68_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const contentSha256 = createHash("sha256")
    .update(content)
    .digest("hex");
  const mainSha256 = createHash("sha256")
    .update(main)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause:
          "CURRENT_A21_OPTION_CONTROLS_NO_LONGER_MATCHED_THE_LEGACY_INTERNAL_NAME_VALUE_CONTRACT",
        primaryLocator: "FORM_CONTRACT",
        fallbackLocator: "EXACT_VISIBLE_LABELS",
        selectedControls: ["TOP_OPTION_MODE", "LOWER_OPTION_ONLY_SELECT"],
        rejectedControls: ["ADDITIONAL_PRODUCT", "OPTION_PLUS_ADDITIONAL_PRODUCT"],
        preSubmitReadback: true,
        marketplaceCompletionRequired: false,
        contentSha256,
        mainSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.31-hf68.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a21-option-primary-locator": "form-contract",
      "x-stock-a21-option-fallback-locator": "exact-visible-labels",
      "x-stock-content-sha256": contentSha256,
      "x-stock-main-sha256": mainSha256,
    },
  });
}
