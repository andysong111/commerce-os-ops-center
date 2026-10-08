import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf29Download } from "../download-hf29/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.5.7";
const VERSION = "0.5.8";
const HOTFIX = "HF30_BCODE_ATOMIC_OPTION_FIRST_A21_BATCH_200";
const BACKGROUND_OLD = "background-v071.js";
const BACKGROUND_NEW = "background-v072.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf29Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf30_manifest_missing");

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
    throw new Error("shopling_stock_hf30_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf30_hf29_checkpoint_missing");
  }

  const parallelBackground = strFromU8(entries["background-v069.js"] || new Uint8Array());
  const optionBackground = strFromU8(entries["background-v071.js"] || new Uint8Array());
  for (const guard of [
    "supportsOptionFirstV069",
    "canDetachFirstV069",
    'active.stage === "WAIT_A21_RESULT" && canDetachFirstV069(active)',
    "batchStart + currentBatch.length >= goodsKeys.length",
  ]) {
    if (!parallelBackground.includes(guard)) {
      throw new Error(`shopling_stock_hf30_parallel_guard_missing:${guard}`);
    }
  }
  for (const guard of [
    "const OPTION_BATCH_MAX_HF30 = 200",
    "optionBatchHardLimitV071",
    'popupPolicy: "NEW_A21_RESULT_WINDOW_PER_BATCH"',
    'const searchToken = batch.join(",")',
    'optionApiMutation: "UNCHANGED_PER_GOODS_KEY_EXACT_BEFORE_A21"',
  ]) {
    if (!optionBackground.includes(guard)) {
      throw new Error(`shopling_stock_hf30_option_guard_missing:${guard}`);
    }
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF30";
  manifest.description =
    "HF30 treats every option B-code as one atomic stock-state job: resolve all Shopling goods keys containing that B-code, apply the exact option state per goods key, then transmit those goods keys through A21 in exact verified batches of up to 200. Every batch opens a fresh A21 result window. OPTION may lead Lane 1, but Lane 2 starts only after the final OPTION batch is submitted, preventing partial option transmission. HF29 fail-closed row verification, HF28 heartbeat and exact result watchers remain intact.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF30`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const required of [
    BACKGROUND_OLD,
    BACKGROUND_NEW,
    "background-v069.js",
    "background-v070.js",
    "content-a21-canonical-v014.js",
    "content-ops-parallel-v001.js",
    "content-ops-heartbeat-v001.js",
  ]) {
    if (!entries[required]) {
      throw new Error(`shopling_stock_hf30_checkpoint_missing:${required}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf30_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const parallelBackgroundSha256 = createHash("sha256")
    .update(parallelBackground)
    .digest("hex");
  const optionBackgroundSha256 = createHash("sha256")
    .update(optionBackground)
    .digest("hex");

  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        bCodeAtomicOptionFlow: true,
        optionApiMutationMode: "PER_GOODS_KEY_EXACT_BEFORE_A21",
        optionA21SearchMode: "COMMA_MULTI_GOODS_KEY",
        optionA21BatchMax: 200,
        optionA21ExactRowVerification: true,
        optionA21MissingKeyPolicy: "FAIL_CLOSED",
        optionA21PopupPolicy: "NEW_A21_RESULT_WINDOW_PER_BATCH",
        optionFirstLaneSupported: true,
        optionLane1DetachPolicy: "FINAL_BATCH_ONLY",
        legacyExtensionSerialFallbackInWeb: true,
        hf29OptionGuardsPreserved: true,
        hf28TwoLaneAndHeartbeatPreserved: true,
        background: BACKGROUND_NEW,
        backgroundSha256,
        parallelBackgroundSha256,
        optionBackgroundSha256,
        liveShoplingVerified: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-stock-state-v${VERSION}-hf30.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-option-a21-batch-max": "200",
      "x-stock-option-first-lane": "FINAL_BATCH_ONLY",
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
