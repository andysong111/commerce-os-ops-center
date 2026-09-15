import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf28Download } from "../download-hf28/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.5.6";
const VERSION = "0.5.7";
const HOTFIX = "HF29_OPTION_A21_COMMA_MULTI_GOODS_KEY_BATCH";
const BACKGROUND_OLD = "background-v070.js";
const BACKGROUND_NEW = "background-v071.js";
const CANONICAL_LIST_FILE = "content-a21-canonical-v014.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf28Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf29_manifest_missing");

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  entries[BACKGROUND_NEW] = strToU8(background);

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
    throw new Error("shopling_stock_hf29_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf29_hf28_checkpoint_missing");
  }
  if (!entries[CANONICAL_LIST_FILE]) {
    throw new Error("shopling_stock_hf29_canonical_list_missing");
  }

  const canonicalList = strFromU8(entries[CANONICAL_LIST_FILE]);
  for (const guard of [
    'assignment.goodsKeys.join(",")',
    'assignment.goodsKeys.length > 200',
    'A21_GOODSKEY_RESULT_MISSING',
    'A21_VISIBLE_ROW_COUNT_MISMATCH',
    'A21_SPLIT_REQUIRED',
  ]) {
    if (!canonicalList.includes(guard)) {
      throw new Error(`shopling_stock_hf29_canonical_guard_missing:${guard}`);
    }
  }

  for (const guard of [
    'importScripts("background-v070.js")',
    "const OPTION_BATCH_MAX_V071 = 20",
    'active.job?.optionApiApplied === true',
    'goodsKeys: batch',
    'const searchToken = batch.join(",")',
    'batchMode: "A21_COMMA_MULTI_GOODS_KEY"',
    "active.goodsKeyIndex = nextStart",
    'optionApiMutation: "UNCHANGED_PER_GOODS_KEY_EXACT_BEFORE_A21"',
    'SHOPLING_OPTION_BATCH_NEXT_DISPATCH_LOST_HF29',
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf29_background_guard_missing:${guard}`);
    }
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF29";
  manifest.description =
    "HF29 preserves HF28 two-lane overlap, heartbeat watchdog, A6 read-only resolution and exact per-goods-key Shopling option API mutation. OPTION A21 transmission now groups up to 20 already-verified goods keys into the proven comma-separated multi-search field, verifies every visible result row against the requested exact keys, selects all matched rows, and opens one OPTION resend popup per batch. Oversized or incomplete result sets remain fail-closed; there is no silent single-key fallback.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF29`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const required of [
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    CANONICAL_LIST_FILE,
    "background-v069.js",
    "content-ops-parallel-v001.js",
    "content-ops-heartbeat-v001.js",
  ]) {
    if (!entries[required]) {
      throw new Error(`shopling_stock_hf29_checkpoint_missing:${required}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf29_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const canonicalListSha256 = createHash("sha256").update(canonicalList).digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        optionApiMutationMode: "UNCHANGED_PER_GOODS_KEY_EXACT_BEFORE_A21",
        optionA21SearchMode: "COMMA_MULTI_GOODS_KEY",
        optionA21BatchMax: 20,
        optionA21SearchDelimiter: ",",
        optionA21ExactRowVerification: true,
        optionA21MissingKeyPolicy: "FAIL_CLOSED",
        optionA21SplitPolicy: "FAIL_CLOSED_EXISTING_CANONICAL_LIMIT",
        optionA21SilentSingleKeyFallback: false,
        canonicalA21EnginePreserved: true,
        canonicalListFile: CANONICAL_LIST_FILE,
        canonicalListSha256,
        hf28TwoLanePreserved: true,
        hf28HeartbeatPreserved: true,
        hf28BackgroundPreserved: true,
        background: BACKGROUND_NEW,
        backgroundSha256,
        liveShoplingVerified: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf29.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-option-a21-mode": "COMMA_MULTI_GOODS_KEY",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-canonical-list-sha256": canonicalListSha256,
    },
  });
}
