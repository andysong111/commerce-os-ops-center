import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf95 } from "@/app/api/shopling-stock-state-sync/download-hf95/route";
import { patchHf96SameAssignmentPopupRearm } from "@/lib/shoplingStockHf96Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.57";
const VERSION = "0.6.58";
const HOTFIX = "HF96_SAME_ASSIGNMENT_POPUP_REARM_RECONCILIATION";
const PATCHED_BACKGROUND = "background-v095.js";
const SERVICE_WORKER = "background-v101.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf95(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf95",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf96_base_download_failed");
  }

  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const backgroundBytes = entries[PATCHED_BACKGROUND];
  const serviceWorkerBytes = entries[SERVICE_WORKER];
  if (!manifestBytes || !backgroundBytes || !serviceWorkerBytes) {
    throw new Error("shopling_stock_hf96_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[]; matches: string[] }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== SERVICE_WORKER
  ) {
    throw new Error("shopling_stock_hf96_manifest_checkpoint_mismatch");
  }

  const background = normalized(
    patchHf96SameAssignmentPopupRearm(strFromU8(backgroundBytes)),
  );
  const serviceWorker = normalized(strFromU8(serviceWorkerBytes));
  new Function(background);
  new Function(serviceWorker);
  entries[PATCHED_BACKGROUND] = strToU8(background);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF96";
  manifest.description =
    "HF96 preserves exact-popup ownership when the identical serialized B-code assignment is re-armed before the blue Shopling submit, while failing closed on any identity mismatch.";
  manifest.action.default_title =
    `Shopling 동일 작업 팝업 소유권 복구 v${VERSION} HF96`;
  entries["manifest.json"] = strToU8(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const guards: Array<[string, string, string]> = [
    ["background", background, "HF96_SAME_ASSIGNMENT_REARM_RECONCILED"],
    ["background", background, "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH"],
    ["background", background, "SHOPLING_HF96_REARM_RECONCILED_AND_COMMITTED"],
    ["background", background, "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT"],
    ["background", background, "bindingMatchesHf84(active, popupTabId)"],
    ["worker", serviceWorker, 'importScripts("background-v098.js")'],
    ["worker", serviceWorker, "STOCK_SYNC_GET_IDLE_STATUS_HF94"],
    ["worker", serviceWorker, "HF94_MINIMAL_IDLE_STATUS"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf96_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf96_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    patchedBackgroundSha256: createHash("sha256")
      .update(background)
      .digest("hex"),
    serviceWorkerSha256: createHash("sha256")
      .update(serviceWorker)
      .digest("hex"),
    baseZipSha256: createHash("sha256").update(baseZip).digest("hex"),
  };

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        popupOwnershipPolicy:
          "RECOVER_ONLY_FROM_FRESH_HF90_RECEIPT_FOR_IDENTICAL_JOB_LIST_POPUP_AND_CANONICAL_ASSIGNMENT",
        mismatchPolicy: "FAIL_CLOSED_BEFORE_EXTERNAL_SUBMIT",
        serialDispatchPolicy: "ONE_BCODE_AT_A_TIME_UNCHANGED",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.58-hf96.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-ownership": "same-assignment-rearm-reconciled",
      "x-stock-patched-background-sha256":
        hashes.patchedBackgroundSha256,
      "x-stock-service-worker-sha256": hashes.serviceWorkerSha256,
    },
  });
}
