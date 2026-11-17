import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf90 } from "@/app/api/shopling-stock-state-sync/download-hf90/route";
import {
  patchHf92ExactPopupDirectCommit,
  patchHf92TrustedClickDetachedReceipt,
} from "@/lib/shoplingStockHf92Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.53";
const VERSION = "0.6.54";
const HOTFIX = "HF92_DETACHED_CLICK_RECEIPT_AND_EXACT_POPUP_DIRECT_COMMIT";
const SERVICE_WORKER = "background-v099.js";
const TRUSTED_CLICK_BACKGROUND = "background-v096.js";
const LAST_MILE_BACKGROUND = "background-v095.js";

export async function GET(request: Request) {
  const baseResponse = await getHf90(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf90"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf92_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const trustedBytes = entries[TRUSTED_CLICK_BACKGROUND];
  const lastMileBytes = entries[LAST_MILE_BACKGROUND];
  if (!manifestBytes || !trustedBytes || !lastMileBytes || !entries[SERVICE_WORKER]) {
    throw new Error("shopling_stock_hf92_base_file_missing");
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
    throw new Error("shopling_stock_hf92_manifest_checkpoint_mismatch");
  }

  const trustedBackground = patchHf92TrustedClickDetachedReceipt(
    strFromU8(trustedBytes),
  );
  const lastMileBackground = patchHf92ExactPopupDirectCommit(
    strFromU8(lastMileBytes),
  );
  new Function(trustedBackground);
  new Function(lastMileBackground);
  entries[TRUSTED_CLICK_BACKGROUND] = strToU8(trustedBackground);
  entries[LAST_MILE_BACKGROUND] = strToU8(lastMileBackground);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF92";
  manifest.description =
    "HF92 reconciles a detached trusted click against the exact new popup and commits the blue Shopling submit directly in that owned popup frame.";
  manifest.action.default_title =
    `Shopling 분리 클릭 복구·정확 팝업 직접 전송 v${VERSION} HF92`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["trusted", trustedBackground, "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED"],
    ["trusted", trustedBackground, "const popup = await waitForNewPopupHf86(tabId, baseline)"],
    ["lastMile", lastMileBackground, "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED"],
    ["lastMile", lastMileBackground, "func: probeLastMileHf84"],
    ["lastMile", lastMileBackground, "func: commitLastMileHf84"],
    ["lastMile", lastMileBackground, 'current.stage = "WAIT_A21_RESULT"'],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf92_guard_missing:${label}:${guard}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf92_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    trustedBackgroundSha256: createHash("sha256")
      .update(trustedBackground)
      .digest("hex"),
    lastMileBackgroundSha256: createHash("sha256")
      .update(lastMileBackground)
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
        detachedClickPolicy:
          "EXACT_NEW_POPUP_RECEIPT_WINS_OVER_SOURCE_TARGET_DETACH",
        blueSubmitPolicy:
          "EXACT_OWNED_POPUP_DIRECT_FRAME_PROBE_AND_ORIGINAL_SHOPLING_COMMIT",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.54-hf92.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-detached-click": "reconcile-exact-new-popup-before-failure",
      "x-stock-blue-submit": "exact-owned-popup-direct-commit",
      "x-stock-trusted-background-sha256": hashes.trustedBackgroundSha256,
      "x-stock-last-mile-background-sha256": hashes.lastMileBackgroundSha256,
    },
  });
}
