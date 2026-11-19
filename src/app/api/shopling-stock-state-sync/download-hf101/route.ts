import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf100 } from "@/app/api/shopling-stock-state-sync/download-hf100/route";
import { patchHf101InFlightInitialOwnerSnapshot } from "@/lib/shoplingStockHf101Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.60";
const VERSION = "0.6.61";
const HOTFIX = "HF101_IN_FLIGHT_INITIAL_OWNER_SNAPSHOT";
const PATCHED_BACKGROUND = "background-v095.js";
const SERVICE_WORKER = "background-v101.js";
const OPS_SCRIPT = "content-ops-v025.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf100(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf100",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf101_base_download_failed");
  }

  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const backgroundBytes = entries[PATCHED_BACKGROUND];
  const serviceWorkerBytes = entries[SERVICE_WORKER];
  const opsBytes = entries[OPS_SCRIPT];
  if (!manifestBytes || !backgroundBytes || !serviceWorkerBytes || !opsBytes) {
    throw new Error("shopling_stock_hf101_base_file_missing");
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
    throw new Error("shopling_stock_hf101_manifest_checkpoint_mismatch");
  }

  const background = normalized(
    patchHf101InFlightInitialOwnerSnapshot(strFromU8(backgroundBytes)),
  );
  const serviceWorker = normalized(strFromU8(serviceWorkerBytes));
  const ops = normalized(strFromU8(opsBytes));
  new Function(background);
  new Function(serviceWorker);
  new Function(ops);
  entries[PATCHED_BACKGROUND] = strToU8(background);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF101";
  manifest.description =
    "HF101 preserves the initially proven exact popup owner during the same in-flight handoff, while blocking any changed job, list, popup or canonical goods-key assignment.";
  manifest.action.default_title =
    `Shopling 실행 중 팝업 소유권 보존 v${VERSION} HF101`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const guard of [
    "HF101_INITIAL_EXACT_POPUP_OWNER_SNAPSHOT",
    "HF101_IN_FLIGHT_INITIAL_OWNER_RECONCILED",
    "HF101_IN_FLIGHT_POPUP_OWNER_CHANGED",
    "HF100_EXACT_POPUP_INITIAL_OWNER_MISMATCH",
    "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf101_guard_missing:${guard}`);
    }
  }
  if (!ops.includes("HF99_ENDED_ONLY_NO_TRANSMISSION")) {
    throw new Error("shopling_stock_hf101_hf99_policy_missing");
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf101_missing_packaged_file:${file}`);
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
        inFlightPopupOwnershipPolicy:
          "IMMUTABLE_INITIAL_HF90_OWNER_SNAPSHOT_FOR_SAME_HANDOFF_ONLY",
        changedAssignmentPolicy:
          "FAIL_CLOSED_BEFORE_EXTERNAL_SUBMIT_ON_JOB_LIST_POPUP_OR_GOODS_KEY_MISMATCH",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.61-hf101.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-ownership": "in-flight-initial-owner-snapshot",
      "x-stock-patched-background-sha256":
        hashes.patchedBackgroundSha256,
    },
  });
}
