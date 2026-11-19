import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf99 } from "@/app/api/shopling-stock-state-sync/download-hf99/route";
import { patchHf100InitialPopupOwnerReconciliation } from "@/lib/shoplingStockHf100Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.59";
const VERSION = "0.6.60";
const HOTFIX = "HF100_INITIAL_POPUP_OWNER_RECONCILIATION";
const PATCHED_BACKGROUND = "background-v095.js";
const SERVICE_WORKER = "background-v101.js";
const OPS_SCRIPT = "content-ops-v025.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf99(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf99",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf100_base_download_failed");
  }

  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const backgroundBytes = entries[PATCHED_BACKGROUND];
  const serviceWorkerBytes = entries[SERVICE_WORKER];
  const opsBytes = entries[OPS_SCRIPT];
  if (!manifestBytes || !backgroundBytes || !serviceWorkerBytes || !opsBytes) {
    throw new Error("shopling_stock_hf100_base_file_missing");
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
    throw new Error("shopling_stock_hf100_manifest_checkpoint_mismatch");
  }

  const background = normalized(
    patchHf100InitialPopupOwnerReconciliation(strFromU8(backgroundBytes)),
  );
  const serviceWorker = normalized(strFromU8(serviceWorkerBytes));
  const ops = normalized(strFromU8(opsBytes));
  new Function(background);
  new Function(serviceWorker);
  new Function(ops);
  entries[PATCHED_BACKGROUND] = strToU8(background);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF100";
  manifest.description =
    "HF100 reconciles the exact current popup at the initial blue-submit boundary only when the fresh HF90 receipt proves the identical serialized B-code assignment.";
  manifest.action.default_title =
    `Shopling 초기 팝업 소유권 복구 v${VERSION} HF100`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    "HF100_EXACT_POPUP_INITIAL_OWNER_MISMATCH",
    "HF100_INITIAL_REARM_RECONCILED",
    "HF96_SAME_ASSIGNMENT_REARM_RECONCILED",
    "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf100_guard_missing:${guard}`);
    }
  }
  if (!ops.includes("HF99_ENDED_ONLY_NO_TRANSMISSION")) {
    throw new Error("shopling_stock_hf100_hf99_policy_missing");
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf100_missing_packaged_file:${file}`);
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
    opsSha256: createHash("sha256").update(ops).digest("hex"),
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
        initialPopupOwnershipPolicy:
          "RECOVER_ONLY_FROM_FRESH_HF90_RECEIPT_FOR_IDENTICAL_JOB_LIST_POPUP_AND_CANONICAL_ASSIGNMENT",
        mismatchPolicy: "FAIL_CLOSED_BEFORE_EXTERNAL_SUBMIT",
        endedProductPolicy:
          "SKIP_E_FOR_ON_SALE_AND_SOLD_OUT_CONTINUE_REMAINING_GOODS_KEYS",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.60-hf100.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-ownership": "initial-same-assignment-reconciled",
      "x-stock-patched-background-sha256":
        hashes.patchedBackgroundSha256,
    },
  });
}
