import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf92 } from "@/app/api/shopling-stock-state-sync/download-hf92/route";
import {
  patchHf93CanonicalSelectionReceipt,
  patchHf93ProgressLabels,
  patchHf93TrustedSelectionReceipt,
} from "@/lib/shoplingStockHf93Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.54";
const VERSION = "0.6.55";
const HOTFIX = "HF93_PRECLICK_SELECTION_RECEIPT_AND_FAST_DIALOG_RECOVERY";
const SERVICE_WORKER = "background-v099.js";
const TRUSTED_CLICK_BACKGROUND = "background-v096.js";
const SINGLE_LIST_BACKGROUND = "background-v056.js";
const CANONICAL_FILES = [
  "content-a21-canonical-v019.js",
  "content-a21-canonical-v020.js",
] as const;

export async function GET(request: Request) {
  const baseResponse = await getHf92(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf92"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf93_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const trustedBytes = entries[TRUSTED_CLICK_BACKGROUND];
  const singleListBytes = entries[SINGLE_LIST_BACKGROUND];
  if (!manifestBytes || !trustedBytes || !singleListBytes || !entries[SERVICE_WORKER]) {
    throw new Error("shopling_stock_hf93_base_file_missing");
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
    manifest.background.service_worker !== SERVICE_WORKER
  ) {
    throw new Error("shopling_stock_hf93_manifest_checkpoint_mismatch");
  }

  const trustedBackground = patchHf93TrustedSelectionReceipt(
    strFromU8(trustedBytes),
  );
  const singleListBackground = patchHf93ProgressLabels(
    strFromU8(singleListBytes),
  );
  new Function(trustedBackground);
  new Function(singleListBackground);
  entries[TRUSTED_CLICK_BACKGROUND] = strToU8(trustedBackground);
  entries[SINGLE_LIST_BACKGROUND] = strToU8(singleListBackground);

  const canonicalHashes: Record<string, string> = {};
  for (const file of CANONICAL_FILES) {
    const bytes = entries[file];
    if (!bytes) throw new Error(`shopling_stock_hf93_canonical_file_missing:${file}`);
    const canonical = patchHf93CanonicalSelectionReceipt(strFromU8(bytes));
    new Function(canonical);
    entries[file] = strToU8(canonical);
    canonicalHashes[`${file.replace(/\.js$/, "")}Sha256`] = createHash("sha256")
      .update(canonical)
      .digest("hex");
  }

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF93";
  manifest.description =
    "HF93 revalidates exact A21 result-row selection in Shopling MAIN world immediately before the trusted modify-send click and closes selection alerts without waiting for a popup timeout.";
  manifest.action.default_title =
    `Shopling 클릭 직전 행 재검증·빠른 경고 복구 v${VERSION} HF93`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["trusted", trustedBackground, "ensureExactRowsSelectedHf93"],
    ["trusted", trustedBackground, 'world: "MAIN"'],
    ["trusted", trustedBackground, "HF93_SELECTION_DIALOG_CAUGHT"],
    ["trusted", trustedBackground, "Page.handleJavaScriptDialog"],
    ["single", singleListBackground, "A21 상품 원본 검색 제출"],
    ["single", singleListBackground, "단품 A21 상품 원본 목록 엔진 연결 대기"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf93_guard_missing:${label}:${guard}`);
    }
  }
  if (singleListBackground.includes("가격조정 원본")) {
    throw new Error("shopling_stock_hf93_stale_price_label_packaged");
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf93_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    trustedBackgroundSha256: createHash("sha256")
      .update(trustedBackground)
      .digest("hex"),
    singleListBackgroundSha256: createHash("sha256")
      .update(singleListBackground)
      .digest("hex"),
    baseZipSha256: createHash("sha256").update(baseZip).digest("hex"),
    ...canonicalHashes,
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rowSelectionPolicy:
          "EXACT_CURRENT_RESULT_ROWS_REVERIFIED_IN_MAIN_WORLD_IMMEDIATELY_BEFORE_TRUSTED_CLICK",
        selectionDialogPolicy:
          "EXACT_NO_SELECTION_ALERT_AUTO_CLOSED_AND_FAILED_FAST_WITHOUT_POPUP_TIMEOUT",
        progressLabelPolicy: "A21_PRODUCT_SOURCE_SEARCH_NOT_PRICE_ADJUSTMENT",
        serialDispatchPolicy: "ONE_BCODE_AT_A_TIME_UNCHANGED",
        duplicateWritePolicy:
          "NO_RECLICK_AFTER_EXACT_POPUP_OR_ORIGINAL_SUBMIT_RECEIPT",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.55-hf93.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-preclick-selection": "exact-main-world-receipt",
      "x-stock-selection-dialog": "close-and-fail-fast",
      "x-stock-trusted-background-sha256": hashes.trustedBackgroundSha256,
      "x-stock-single-list-background-sha256":
        hashes.singleListBackgroundSha256,
    },
  });
}
