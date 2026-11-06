import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf77MainWorldSource } from "@/lib/shoplingStockHf77Patch";
import { GET as getHf76Download } from "../download-hf76/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.39";
const VERSION = "0.6.40";
const HOTFIX = "HF77_DOCUMENT_START_SAFE_MAIN_WORLD_CLICK_BRIDGE";
const BASE_MAIN = "main-shopling.js";
const MAIN = "main-shopling-v002.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf76Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const mainBytes = entries[BASE_MAIN];
  if (!manifestBytes || !mainBytes) {
    throw new Error("shopling_stock_hf77_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{
      matches: string[];
      exclude_matches?: string[];
      js: string[];
      all_frames?: boolean;
      run_at?: string;
      world?: string;
    }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf77_manifest_checkpoint_mismatch");
  }

  const main = patchHf77MainWorldSource(normalized(strFromU8(mainBytes)));
  new Function(main);
  entries[MAIN] = strToU8(main);

  const mainWorldEntry = manifest.content_scripts.find(
    (script) => script.world === "MAIN" && script.js.includes(BASE_MAIN),
  );
  if (!mainWorldEntry) {
    throw new Error("shopling_stock_hf77_main_world_entry_missing");
  }
  if (mainWorldEntry.run_at !== "document_start" || mainWorldEntry.all_frames !== true) {
    throw new Error("shopling_stock_hf77_main_world_entry_checkpoint_mismatch");
  }
  mainWorldEntry.js = mainWorldEntry.js.map((file) =>
    file === BASE_MAIN ? MAIN : file,
  );
  const oldMainStillReferenced = manifest.content_scripts.some((script) =>
    script.js.includes(BASE_MAIN),
  );
  if (!oldMainStillReferenced) delete entries[BASE_MAIN];

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF77";
  manifest.description =
    "HF77 installs the Shopling red-list-action bridge safely even when Chrome injects at document_start before the DOM root exists.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF77`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards = [
    "commerce-os-stock-main-click",
    "commerce-os-stock-main-click-result",
    "const startObserver = () =>",
    "if (!startObserver())",
    'window.addEventListener("DOMContentLoaded", startObserver, { once: true })',
  ];
  for (const guard of guards) {
    if (!main.includes(guard)) {
      throw new Error(`shopling_stock_hf77_main_guard_missing:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf77_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const mainSha256 = createHash("sha256").update(main).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        rootCause:
          "MAIN_WORLD_OBSERVER_THROW_BEFORE_CLICK_REQUEST_LISTENER_AT_DOCUMENT_START",
        requestListener: "SURVIVES_MISSING_DOCUMENT_ELEMENT",
        goodsKeyDispatch: "ONE_ASSIGNMENT_PER_COMPATIBLE_GROUP_UP_TO_200",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        marketplaceCompletionRequired: false,
        liveShoplingVerificationRequired: true,
        mainSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.40-hf77.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-main-world-sha256": mainSha256,
    },
  });
}
