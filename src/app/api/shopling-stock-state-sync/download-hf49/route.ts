import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf49CanonicalWorker,
  patchShoplingStockHf49OptionBackground,
  patchShoplingStockHf49OptionBatch,
  patchShoplingStockHf49SingleBackground,
  patchShoplingStockHf49SingleBatch,
} from "@/lib/shoplingStockHf49Patch";
import { GET as getHf48Download } from "../download-hf48/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.13";
const VERSION = "0.6.14";
const HOTFIX = "HF49_EXACT_CANONICAL_OWNER_AFTER_PAGE_RELOAD";
const CANONICAL_WORKER = "content-a21-canonical-v014.js";
const OPTION_BACKGROUND = "background-v053.js";
const SINGLE_BACKGROUND = "background-v056.js";
const SINGLE_BATCH = "background-v057.js";
const OPTION_BATCH = "background-v071.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf48Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[CANONICAL_WORKER];
  const optionBackgroundBytes = entries[OPTION_BACKGROUND];
  const singleBackgroundBytes = entries[SINGLE_BACKGROUND];
  const singleBatchBytes = entries[SINGLE_BATCH];
  const optionBatchBytes = entries[OPTION_BATCH];
  if (
    !manifestBytes ||
    !workerBytes ||
    !optionBackgroundBytes ||
    !singleBackgroundBytes ||
    !singleBatchBytes ||
    !optionBatchBytes
  ) {
    throw new Error("shopling_stock_hf49_required_entry_missing");
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
    throw new Error("shopling_stock_hf49_manifest_version_mismatch");
  }

  const worker = patchShoplingStockHf49CanonicalWorker(
    strFromU8(workerBytes),
  );
  const optionBackground = patchShoplingStockHf49OptionBackground(
    strFromU8(optionBackgroundBytes),
  );
  const singleBackground = patchShoplingStockHf49SingleBackground(
    strFromU8(singleBackgroundBytes),
  );
  const singleBatch = patchShoplingStockHf49SingleBatch(
    strFromU8(singleBatchBytes),
  );
  const optionBatch = patchShoplingStockHf49OptionBatch(
    strFromU8(optionBatchBytes),
  );
  for (const script of [
    worker,
    optionBackground,
    singleBackground,
    singleBatch,
    optionBatch,
  ]) {
    new Function(script);
  }

  const guards: Array<[string, string, string]> = [
    [optionBatch, 'stockProductKindHf48: "OPTION"', OPTION_BATCH],
    [singleBatch, 'stockProductKindHf48: "SINGLE"', SINGLE_BATCH],
    [
      optionBackground,
      'stockProductKindHf48 || "") !== "OPTION"',
      OPTION_BACKGROUND,
    ],
    [
      singleBackground,
      'stockProductKindHf48 || "") !== "SINGLE"',
      SINGLE_BACKGROUND,
    ],
    [
      singleBatch,
      'stockProductKindHf48 || "") !== "SINGLE"',
      `${SINGLE_BATCH}:split`,
    ],
    [
      worker,
      "stockProductKindHf48: String(parsed.stockProductKindHf48",
      `${CANONICAL_WORKER}:opener`,
    ],
  ];
  for (const [script, guard, file] of guards) {
    if (!script.includes(guard)) {
      throw new Error(`shopling_stock_hf49_guard_missing:${file}:${guard}`);
    }
  }

  entries[CANONICAL_WORKER] = strToU8(worker);
  entries[OPTION_BACKGROUND] = strToU8(optionBackground);
  entries[SINGLE_BACKGROUND] = strToU8(singleBackground);
  entries[SINGLE_BATCH] = strToU8(singleBatch);
  entries[OPTION_BATCH] = strToU8(optionBatch);
  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF49";
  manifest.description =
    "HF49 preserves OPTION/SINGLE ownership across the real post-search page reload and popup/result markers. Only the exact owner adapter may acknowledge canonical A21 messages; missing ownership fails closed before 상품 수정전송.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF49`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    CANONICAL_WORKER,
    OPTION_BACKGROUND,
    SINGLE_BACKGROUND,
    SINGLE_BATCH,
    OPTION_BATCH,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf49_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    [
      [CANONICAL_WORKER, worker],
      [OPTION_BACKGROUND, optionBackground],
      [SINGLE_BACKGROUND, singleBackground],
      [SINGLE_BATCH, singleBatch],
      [OPTION_BATCH, optionBatch],
    ].map(([file, script]) => [
      file,
      createHash("sha256").update(script).digest("hex"),
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
        optionBatchAssignmentOwner: "OPTION",
        singleBatchAssignmentOwner: "SINGLE",
        missingOwnerAcknowledged: false,
        exactOwnerAdapterCount: 1,
        popupOpeningAckRequiredBeforeClick: true,
        modifySendClickAllowedWithoutAck: false,
        incidentRegression:
          "BDE7-3_OPTION_BATCH_RELOAD_DROPPED_OWNER_AND_REOPENED_ACK_RACE",
        hashes,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.14-hf49.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-canonical-owner-required": "true",
      "x-stock-option-batch-sha256": hashes[OPTION_BATCH],
      "x-stock-single-batch-sha256": hashes[SINGLE_BATCH],
      "x-stock-canonical-worker-sha256": hashes[CANONICAL_WORKER],
    },
  });
}
