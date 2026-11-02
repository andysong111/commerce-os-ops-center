import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchShoplingStockHf53CanonicalWorker } from "@/lib/shoplingStockHf53Patch";
import { GET as getHf52Download } from "../download-hf52/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.17";
const VERSION = "0.6.18";
const HOTFIX = "HF53_SAFE_STALE_A21_POPUP_PREFLIGHT";
const CANONICAL_WORKER = "content-a21-canonical-v014.js";
const BACKGROUND_OLD = "background-v076.js";
const BACKGROUND_NEW = "background-v077.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf52Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const workerBytes = entries[CANONICAL_WORKER];
  if (!manifestBytes || !workerBytes || !entries[BACKGROUND_OLD]) {
    throw new Error("shopling_stock_hf53_required_entry_missing");
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
    manifest.background.service_worker !== BACKGROUND_OLD
  ) {
    throw new Error("shopling_stock_hf53_manifest_checkpoint_mismatch");
  }

  const worker = patchShoplingStockHf53CanonicalWorker(
    strFromU8(workerBytes),
  );
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(worker);
  new Function(background);
  for (const guard of [
    "A21_STALE_POPUP_PREFLIGHT_HF53",
    "stalePopupPreflightHf53?.ok !== true",
    "A21_STALE_POPUP_PREFLIGHT_FAILED_HF53",
  ]) {
    if (!worker.includes(guard)) {
      throw new Error(`shopling_stock_hf53_worker_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    'importScripts("background-v076.js")',
    "safeStalePreSubmit",
    "A21_EXISTING_POPUP_NOT_SAFE_TO_CLOSE_HF53",
    "A21_POPUP_NOT_OPENED_HF53",
    "priorA21TransmissionSubmitted: false",
    "ambiguousPopupClosed: false",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf53_background_guard_missing:${guard}`);
    }
  }

  entries[CANONICAL_WORKER] = strToU8(worker);
  entries[BACKGROUND_NEW] = strToU8(background);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF53";
  manifest.description =
    "HF53 clears only an exact stale pre-submit A21 popup before dispatch, blocks every ambiguous existing popup, and terminates a missing fresh popup without blind retries.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF53`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    CANONICAL_WORKER,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf53_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const workerHash = createHash("sha256").update(worker).digest("hex");
  const backgroundHash = createHash("sha256").update(background).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        stalePopupPreflightRequiredBeforeClick: true,
        safeStalePreSubmitPopupAutoClosed: true,
        ambiguousExistingPopupBlocked: true,
        missingFreshPopupBlindRetry: false,
        incidentRegression:
          "BBA7_1_OLD_V0616_NAMED_A21_POPUP_REUSED_WHILE_NEW_SEND_REACHED_RESULT",
        workerHash,
        backgroundHash,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.18-hf53.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-worker-sha256": workerHash,
      "x-stock-background-sha256": backgroundHash,
    },
  });
}
