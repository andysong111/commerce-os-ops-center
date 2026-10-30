import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf48CanonicalWorker,
  patchShoplingStockHf48OptionBackground,
  patchShoplingStockHf48SingleBackground,
} from "@/lib/shoplingStockHf48Patch";
import { GET as getHf47Download } from "../download-hf47/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.12";
const VERSION = "0.6.13";
const HOTFIX = "HF48_CANONICAL_MESSAGE_ROUTE_ACK";
const CANONICAL_WORKER = "content-a21-canonical-v014.js";
const OPTION_BACKGROUND = "background-v053.js";
const SINGLE_BACKGROUND = "background-v056.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf47Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[CANONICAL_WORKER];
  const optionBackgroundBytes = entries[OPTION_BACKGROUND];
  const singleBackgroundBytes = entries[SINGLE_BACKGROUND];
  if (
    !manifestBytes ||
    !workerBytes ||
    !optionBackgroundBytes ||
    !singleBackgroundBytes
  ) {
    throw new Error("shopling_stock_hf48_required_entry_missing");
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
    throw new Error("shopling_stock_hf48_manifest_version_mismatch");
  }

  const worker = patchShoplingStockHf48CanonicalWorker(
    strFromU8(workerBytes),
  );
  const optionBackground = patchShoplingStockHf48OptionBackground(
    strFromU8(optionBackgroundBytes),
  );
  const singleBackground = patchShoplingStockHf48SingleBackground(
    strFromU8(singleBackgroundBytes),
  );
  new Function(worker);
  new Function(optionBackground);
  new Function(singleBackground);

  for (const guard of [
    "const stockProductKindsHf48 = new Map()",
    "stockProductKindHf48: String(stockProductKindsHf48.get(String(jobId))",
    "stockProductKindsHf48.set(String(message.jobId)",
  ]) {
    if (!worker.includes(guard)) {
      throw new Error(`shopling_stock_hf48_worker_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'stockProductKindHf48: "OPTION"',
    'stockProductKindHf48 || "") === "SINGLE"',
  ]) {
    if (!optionBackground.includes(guard)) {
      throw new Error(
        `shopling_stock_hf48_option_background_guard_missing:${guard}`,
      );
    }
  }
  for (const guard of [
    'stockProductKindHf48: "SINGLE"',
    'stockProductKindHf48 || "") === "OPTION"',
    "return { ok: true, accepted: true }",
  ]) {
    if (!singleBackground.includes(guard)) {
      throw new Error(
        `shopling_stock_hf48_single_background_guard_missing:${guard}`,
      );
    }
  }

  entries[CANONICAL_WORKER] = strToU8(worker);
  entries[OPTION_BACKGROUND] = strToU8(optionBackground);
  entries[SINGLE_BACKGROUND] = strToU8(singleBackground);
  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF48";
  manifest.description =
    "HF48 routes canonical A21 acknowledgements to exactly one OPTION or SINGLE background adapter. It preserves HF47 fail-closed behavior while allowing the persisted POPUP_OPENING acknowledgement to reach the worker.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF48`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    CANONICAL_WORKER,
    OPTION_BACKGROUND,
    SINGLE_BACKGROUND,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf48_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  const optionBackgroundSha256 = createHash("sha256")
    .update(optionBackground)
    .digest("hex");
  const singleBackgroundSha256 = createHash("sha256")
    .update(singleBackground)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        canonicalMessageRouteField: "stockProductKindHf48",
        optionStageHandledOnlyByOptionAdapter: true,
        singleStageHandledOnlyBySingleAdapter: true,
        popupOpeningAckRequiredBeforeClick: true,
        modifySendClickAllowedWithoutAck: false,
        incidentRegression:
          "BDE7-3_OPTION_ACK_RACED_BY_SINGLE_BACKGROUND_LISTENER",
        canonicalWorker: CANONICAL_WORKER,
        optionBackground: OPTION_BACKGROUND,
        singleBackground: SINGLE_BACKGROUND,
        workerSha256,
        optionBackgroundSha256,
        singleBackgroundSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.13-hf48.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-canonical-message-route": "stockProductKindHf48",
      "x-stock-canonical-worker-sha256": workerSha256,
      "x-stock-option-background-sha256": optionBackgroundSha256,
      "x-stock-single-background-sha256": singleBackgroundSha256,
    },
  });
}
