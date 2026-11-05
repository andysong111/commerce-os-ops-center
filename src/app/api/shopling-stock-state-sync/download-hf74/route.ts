import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf74CanonicalListSource } from "@/lib/shoplingStockHf74Patch";
import { GET as getHf73Download } from "../download-hf73/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.36";
const VERSION = "0.6.37";
const HOTFIX = "HF74_GROUPED_A21_ASSIGNMENT_AND_MAIN_WORLD_LIST_ACTION";
const BASE_BACKGROUND = "background-v092.js";
const BACKGROUND = "background-v093.js";
const BASE_CANONICAL = "content-a21-canonical-v014.js";
const CANONICAL = "content-a21-canonical-v015.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf73Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_CANONICAL]) {
    throw new Error("shopling_stock_hf74_base_file_missing");
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
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf74_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(
    await readFile(path.join(root, BACKGROUND), "utf8"),
  );
  const canonical = patchHf74CanonicalListSource(
    normalized(strFromU8(entries[BASE_CANONICAL])),
  );
  new Function(background);
  new Function(canonical);

  entries[BACKGROUND] = strToU8(background);
  // Keep the legacy filename patched as well because older adapters may inject
  // it dynamically for a non-grouped recovery. The manifest uses only v015.
  entries[BASE_CANONICAL] = strToU8(canonical);
  entries[CANONICAL] = strToU8(canonical);

  const canonicalEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CANONICAL),
  );
  if (!canonicalEntry) {
    throw new Error("shopling_stock_hf74_canonical_entry_missing");
  }
  canonicalEntry.js = canonicalEntry.js.map((file) =>
    file === BASE_CANONICAL ? CANONICAL : file,
  );

  const mainWorldBridge = manifest.content_scripts.find(
    (script) => script.world === "MAIN" && script.js.includes("main-shopling.js"),
  );
  if (!mainWorldBridge) {
    throw new Error("shopling_stock_hf74_main_world_bridge_missing");
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF74";
  manifest.description =
    "HF74 sends every compatible API-classified goods key in one A21 assignment and clicks the red Shopling list action through the proven main-world bridge.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF74`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v092.js")'],
    ["background", background, "goodsKeys: batch"],
    ["background", background, "stockProductKindHf48: group.effectiveProductKind"],
    ["background", background, "await ensureResultBaselineV093(active)"],
    ["background", background, "shoplingResultBaselineTabIdsHf72"],
    ["background", background, "serialPerGoodsKey: false"],
    ["background", background, "content-a21-canonical-v015.js"],
    ["canonical", canonical, "commerce-os-stock-main-click"],
    ["canonical", canonical, "A21_MODIFY_SEND_MAIN_CLICKED"],
    ["canonical", canonical, "await clickModifySend()"],
    ["canonical", canonical, "message.goodsKeys.join"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf74_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf74_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256").update(background).digest("hex"),
    canonicalSha256: createHash("sha256").update(canonical).digest("hex"),
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        goodsKeyDispatch: "ONE_ASSIGNMENT_PER_COMPATIBLE_GROUP_UP_TO_200",
        canonicalOwnerRouting: "OPTION_OR_SINGLE_PER_COMPATIBLE_GROUP",
        resultTabBaseline: "CAPTURED_ONCE_BEFORE_EACH_GROUPED_BATCH",
        listActionClick: "SHOPLING_MAIN_WORLD_EVENT_BRIDGE",
        popupSubmitCardinality: "ONE_PER_COMPATIBLE_GROUP",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        marketplaceCompletionRequired: false,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.37-hf74.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-goods-key-dispatch": "one-compatible-batch-up-to-200",
      "x-stock-list-click": "shopling-main-world-event-bridge",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-canonical-sha256": hashes.canonicalSha256,
    },
  });
}
