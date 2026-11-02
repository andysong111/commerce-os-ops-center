import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf54Download } from "../download-hf54/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.19";
const VERSION = "0.6.20";
const HOTFIX = "HF57_SHOPLING_DISPATCH_ACCEPTANCE_BOUNDARY";
const BACKGROUND_OLD = "background-v078.js";
const BACKGROUND_NEW = "background-v079.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf54Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BACKGROUND_OLD]) {
    throw new Error("shopling_stock_hf57_required_entry_missing");
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
    throw new Error("shopling_stock_hf57_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  for (const guard of [
    'importScripts("background-v078.js")',
    'const RESULT_PATH = "/prod_a/prod_status_trsmt.phtml"',
    "SHOPLING_DISPATCH_ACCEPTED_HF57",
    "shoplingDispatchAccepted: true",
    "commerceOsResponsibilityComplete: true",
    "marketplaceCompletionRequired: false",
    "finalOptionBatchSubmitted",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf57_background_guard_missing:${guard}`);
    }
  }

  entries[BACKGROUND_NEW] = strToU8(background);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF57";
  manifest.description =
    "HF57 completes Commerce OS responsibility when the exact Shopling result-page navigation proves A21 transmission acceptance. Marketplace completion remains Shopling-owned, so the next B-code no longer waits minutes for every market result.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF57`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf57_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
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
        commerceOsTerminalBoundary: "SHOPLING_RESULT_NAVIGATION_ACCEPTED",
        marketplaceCompletionRequired: false,
        boundedParallelAfterAcceptance: true,
        maxConcurrentDispatchLanes: 2,
        stopQueueOnFirstFailure: true,
        noAutomaticRetry: true,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.20-hf57.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-terminal-boundary": "shopling-result-navigation-accepted",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
