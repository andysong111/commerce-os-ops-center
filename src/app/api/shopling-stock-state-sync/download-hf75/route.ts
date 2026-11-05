import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf75CanonicalListSource } from "@/lib/shoplingStockHf75Patch";
import { GET as getHf74Download } from "../download-hf74/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.37";
const VERSION = "0.6.38";
const HOTFIX = "HF75_FRESH_A21_EXECUTION_OWNER_AND_EXACT_QUERY_GUARD";
const BASE_BACKGROUND = "background-v093.js";
const BACKGROUND = "background-v094.js";
const BASE_CANONICAL = "content-a21-canonical-v015.js";
const CANONICAL = "content-a21-canonical-v016.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf74Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_CANONICAL]) {
    throw new Error("shopling_stock_hf75_base_file_missing");
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
    throw new Error("shopling_stock_hf75_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(
    await readFile(path.join(root, BACKGROUND), "utf8"),
  );
  const canonical = patchHf75CanonicalListSource(
    normalized(strFromU8(entries[BASE_CANONICAL])),
  );
  new Function(background);
  new Function(canonical);

  entries[BACKGROUND] = strToU8(background);
  entries[BASE_CANONICAL] = strToU8(canonical);
  entries[CANONICAL] = strToU8(canonical);

  const canonicalEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CANONICAL),
  );
  if (!canonicalEntry) {
    throw new Error("shopling_stock_hf75_canonical_entry_missing");
  }
  canonicalEntry.js = canonicalEntry.js.map((file) =>
    file === BASE_CANONICAL ? CANONICAL : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF75";
  manifest.description =
    "HF75 binds each B-code to a fresh exact A21 list worker and refuses stale search rows unless the owner marker and full goods-key query match.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF75`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v093.js")'],
    ["background", background, "HF75_EXECUTION_FRESH_A21_WORKER"],
    ["background", background, "ensureExecutionWorkerV094"],
    ["background", background, "legacyDispatchToTargetV094(active, worker)"],
    ["canonical", canonical, "A21_LIST_ASSIGNMENT_OWNER_MISMATCH_HF75"],
    ["canonical", canonical, "A21_LIST_QUERY_OWNER_MISMATCH_HF75"],
    ["canonical", canonical, "markerOwnsAssignmentHf75"],
    ["canonical", canonical, "normalizedGoodsKeysHf75(message.goodsKeys)"],
    ["canonical", canonical, "await clickModifySend()"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf75_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf75_missing_packaged_file:${file}`);
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
        executionWorkerOwnership: "ONE_FRESH_EXACT_A21_WORKER_PER_B_CODE",
        staleResultGuard:
          "OWNER_MARKER_AND_EXACT_GOODS_KEY_QUERY_REQUIRED_BEFORE_ROW_SELECTION",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.38-hf75.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-goods-key-dispatch": "one-compatible-batch-up-to-200",
      "x-stock-a21-worker": "fresh-per-b-code-execution",
      "x-stock-stale-result-guard": "owner-and-exact-query",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-canonical-sha256": hashes.canonicalSha256,
    },
  });
}
