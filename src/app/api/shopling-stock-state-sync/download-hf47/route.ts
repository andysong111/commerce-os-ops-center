import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf47Background,
  patchShoplingStockHf47CanonicalWorker,
} from "@/lib/shoplingStockHf47Patch";
import { GET as getHf46Download } from "../download-hf46/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.11";
const VERSION = "0.6.12";
const HOTFIX = "HF47_POPUP_OPENING_STAGE_ACK_FAIL_CLOSED";
const CANONICAL_WORKER = "content-a21-canonical-v014.js";
const CANONICAL_BACKGROUND = "background-v053.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf46Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[CANONICAL_WORKER];
  const backgroundBytes = entries[CANONICAL_BACKGROUND];
  if (!manifestBytes || !workerBytes || !backgroundBytes) {
    throw new Error("shopling_stock_hf47_required_entry_missing");
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
    throw new Error("shopling_stock_hf47_manifest_version_mismatch");
  }

  const worker = patchShoplingStockHf47CanonicalWorker(strFromU8(workerBytes));
  const background = patchShoplingStockHf47Background(
    strFromU8(backgroundBytes),
  );
  new Function(worker);
  new Function(background);

  for (const guard of [
    "for (let attemptHf47 = 1; attemptHf47 <= 2; attemptHf47 += 1)",
    "popupOpeningStageHf47?.accepted !== true",
    "A21_POPUP_OPENING_STAGE_NOT_ACKNOWLEDGED_HF47",
  ]) {
    if (!worker.includes(guard)) {
      throw new Error(`shopling_stock_hf47_worker_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "async function failStaleSearchSubmittedHf47",
    'active.a21CanonicalStage !== "SEARCH_SUBMITTED"',
    "staleAgeMs < 30_000",
    "optionApiMutationRepeatedByRecovery: false",
    "a21TransmissionSubmittedByRecovery: false",
    "priorA21TransmissionSubmitted: popupPresent ? null : false",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf47_background_guard_missing:${guard}`);
    }
  }

  entries[CANONICAL_WORKER] = strToU8(worker);
  entries[CANONICAL_BACKGROUND] = strToU8(background);
  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF47";
  manifest.description =
    "HF47 requires a persisted POPUP_OPENING acknowledgment before clicking Shopling 상품 수정전송. Missing acknowledgments fail closed, and stale BDE7-3-style SEARCH_SUBMITTED jobs are terminated without repeating option mutation or A21 transmission.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF47`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    CANONICAL_WORKER,
    CANONICAL_BACKGROUND,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf47_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const backgroundSha256 = createHash("sha256")
    .update(background)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        popupOpeningStageAckRequiredBeforeClick: true,
        popupOpeningStageAckAttempts: 2,
        modifySendClickAllowedWithoutAck: false,
        staleSearchSubmittedFailClosedMs: 30_000,
        optionApiMutationRepeatedDuringRecovery: false,
        a21TransmissionSubmittedDuringRecovery: false,
        incidentRegression:
          "BDE7-3_SIX_NOOP_OPTIONS_POPUP_OPENED_WITHOUT_STAGE_ACK",
        canonicalWorker: CANONICAL_WORKER,
        canonicalBackground: CANONICAL_BACKGROUND,
        workerSha256,
        backgroundSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.12-hf47.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-opening-stage-ack-required": "true",
      "x-stock-canonical-worker-sha256": workerSha256,
      "x-stock-canonical-background-sha256": backgroundSha256,
    },
  });
}
