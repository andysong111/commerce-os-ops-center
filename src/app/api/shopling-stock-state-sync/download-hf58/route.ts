import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchShoplingStockHf58DispatchAcceptance,
  patchShoplingStockHf58PopupOwnership,
} from "@/lib/shoplingStockHf58Patch";
import { GET as getHf57Download } from "../download-hf57/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.20";
const VERSION = "0.6.21";
const HOTFIX = "HF58_PROCESSING_SCREEN_ACCEPTANCE_AND_POPUP_OWNER_SCOPE";
const BACKGROUND_77 = "background-v077.js";
const BACKGROUND_77_HF58 = "background-v077-hf58.js";
const BACKGROUND_78 = "background-v078.js";
const BACKGROUND_78_HF58 = "background-v078-hf58.js";
const BACKGROUND_79 = "background-v079.js";
const BACKGROUND_80 = "background-v080.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf57Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [
    BACKGROUND_77,
    BACKGROUND_78,
    BACKGROUND_79,
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf58_required_entry_missing:${file}`);
    }
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf58_manifest_missing");

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
    manifest.background.service_worker !== BACKGROUND_79
  ) {
    throw new Error("shopling_stock_hf58_manifest_checkpoint_mismatch");
  }

  const patched77 = patchShoplingStockHf58PopupOwnership(
    strFromU8(entries[BACKGROUND_77]),
  );
  const patched78 = strFromU8(entries[BACKGROUND_78])
    .replace(/\r\n/g, "\n")
    .replace(
      'importScripts("background-v077.js")',
      'importScripts("background-v077-hf58.js")',
    );
  if (!patched78.includes('importScripts("background-v077-hf58.js")')) {
    throw new Error("shopling_stock_hf58_patched_78_import_missing");
  }
  const background80 = patchShoplingStockHf58DispatchAcceptance(
    strFromU8(entries[BACKGROUND_79]),
  );

  for (const [name, source] of [
    [BACKGROUND_77_HF58, patched77],
    [BACKGROUND_78_HF58, patched78],
    [BACKGROUND_80, background80],
  ] as const) {
    new Function(source);
    entries[name] = strToU8(source);
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_80;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF58";
  manifest.description =
    "HF58 treats the visible Shopling processing/result screen as Commerce OS dispatch completion and scopes stale-popup checks to the exact A21 opener tab, so another lane's processing popup cannot falsely block the current B-code.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF58`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf58_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    background77: createHash("sha256").update(patched77).digest("hex"),
    background78: createHash("sha256").update(patched78).digest("hex"),
    background80: createHash("sha256").update(background80).digest("hex"),
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        commerceOsTerminalBoundary:
          "SHOPLING_PROCESSING_SCREEN_OR_RESULT_NAVIGATION",
        marketplaceCompletionRequired: false,
        popupOwnershipScope: "EXACT_OPENER_TAB",
        foreignProcessingPopupsBlockCurrentJob: false,
        maxConcurrentDispatchLanes: 2,
        stopQueueOnFirstFailure: true,
        noAutomaticRetry: true,
        hashes,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.21-hf58.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-terminal-boundary": "shopling-processing-screen-accepted",
      "x-stock-popup-ownership": "exact-opener-tab",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": hashes.background80,
    },
  });
}
