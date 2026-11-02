import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf59Download } from "../download-hf59/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.22";
const VERSION = "0.6.23";
const HOTFIX = "HF60_NESTED_A21_RESULT_OWNER_CHAIN";
const BASE_BACKGROUND = "background-v081.js";
const BACKGROUND = "background-v082.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf59Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND]) {
    throw new Error("shopling_stock_hf60_base_package_missing");
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
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf60_manifest_checkpoint_mismatch");
  }

  const worker = await readFile(
    path.join(
      process.cwd(),
      "public",
      "shopling-stock-state-sync",
      BACKGROUND,
    ),
    "utf8",
  );
  new Function(worker);
  entries[BACKGROUND] = strToU8(worker);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF60";
  manifest.description =
    "HF60 recognizes Shopling's real nested OPTION result-tab chain and completes Commerce OS responsibility when the owned processing/result screen starts.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF60`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf60_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(worker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        commerceOsTerminalBoundary:
          "EXACT_OWNER_A21_PROCESSING_SCREEN_OR_NESTED_RESULT_NAVIGATION",
        marketplaceCompletionRequired: false,
        samePopupProcessingEvidenceAccepted: true,
        nestedResultOwnerChainAccepted: true,
        workerStartRecovery: true,
        popupOwnershipScope:
          "A21_LIST_TO_CLAIMED_POPUP_TO_EXACT_RESULT_TAB",
        maxConcurrentDispatchLanes: 2,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.23-hf60.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-terminal-boundary": "exact-owner-nested-a21-result-chain",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
