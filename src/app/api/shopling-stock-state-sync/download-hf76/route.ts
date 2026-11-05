import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf76CanonicalListSource } from "@/lib/shoplingStockHf76Patch";
import { GET as getHf75Download } from "../download-hf75/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.38";
const VERSION = "0.6.39";
const HOTFIX = "HF76_PREPARED_A21_ACK_AND_STABLE_EXECUTION_OWNER";
const BASE_BACKGROUND = "background-v094.js";
const BACKGROUND = "background-v095.js";
const BASE_CANONICAL = "content-a21-canonical-v016.js";
const CANONICAL = "content-a21-canonical-v019.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf75Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_CANONICAL]) {
    throw new Error("shopling_stock_hf76_base_file_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ matches: string[]; js: string[] }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf76_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(await readFile(path.join(root, BACKGROUND), "utf8"));
  const canonical = patchHf76CanonicalListSource(
    normalized(strFromU8(entries[BASE_CANONICAL])),
  );
  new Function(background);
  new Function(canonical);

  entries[BACKGROUND] = strToU8(background);
  entries[CANONICAL] = strToU8(canonical);
  delete entries[BASE_CANONICAL];

  const canonicalEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CANONICAL),
  );
  if (!canonicalEntry) throw new Error("shopling_stock_hf76_canonical_entry_missing");
  canonicalEntry.js = canonicalEntry.js.map((file) =>
    file === BASE_CANONICAL ? CANONICAL : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF76";
  manifest.description =
    "HF76 accepts A21 work only after the fresh worker proves exact goods-key input and stable B-code execution ownership.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF76`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v094.js")'],
    ["background", background, "SHOPLING_HF76_PREPARED_ACK_MISSING"],
    ["background", background, "preparedAckMatchesV095"],
    ["background", background, "content-a21-canonical-v019.js"],
    ["canonical", canonical, 'const VERSION = "0.1.9"'],
    ["canonical", canonical, "prepareListAssignmentHf76"],
    ["canonical", canonical, "prepared: true"],
    ["canonical", canonical, "assignmentOwnerKeyHf76"],
    ["canonical", canonical, "await clickModifySend()"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf76_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf76_missing_packaged_file:${file}`);
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
        assignmentAcceptance:
          "EXACT_OWNER_AND_EXACT_GOODS_KEY_QUERY_PREPARED_BEFORE_ACK",
        lifecycleOwnership: "STABLE_ACROSS_LIST_START_AND_SEARCH_SUBMITTED",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.39-hf76.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-assignment-acceptance": "exact-owner-and-query-prepared",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-canonical-sha256": hashes.canonicalSha256,
    },
  });
}
