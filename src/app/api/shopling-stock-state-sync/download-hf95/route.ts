import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf94 } from "@/app/api/shopling-stock-state-sync/download-hf94/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.56";
const VERSION = "0.6.57";
const HOTFIX = "HF95_FLATTENED_BACKGROUND_AND_TIMED_IDLE_RECEIPT";
const BASE_BACKGROUND = "background-v100.js";
const FLAT_BASE_BACKGROUND = "background-v099.js";
const BACKGROUND = "background-v101.js";
const BASE_IDLE_BRIDGE = "content-ops-idle-hf94.js";
const IDLE_BRIDGE = "content-ops-idle-hf95.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

function withoutWrapperImport(source: string) {
  const normalizedSource = normalized(source);
  const wrapper = 'importScripts("background-v099.js");';
  if (!normalizedSource.startsWith(wrapper)) {
    throw new Error("shopling_stock_hf95_hf94_wrapper_checkpoint_mismatch");
  }
  return normalizedSource.slice(wrapper.length).replace(/^\s+/, "");
}

export async function GET(request: Request) {
  const baseResponse = await getHf94(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf94",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf95_base_download_failed");
  }
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const wrappedBackgroundBytes = entries[BASE_BACKGROUND];
  const flatBaseBackgroundBytes = entries[FLAT_BASE_BACKGROUND];
  if (
    !manifestBytes ||
    !wrappedBackgroundBytes ||
    !flatBaseBackgroundBytes ||
    !entries[BASE_IDLE_BRIDGE]
  ) {
    throw new Error("shopling_stock_hf95_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[]; matches: string[] }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf95_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const idleBridge = normalized(
    await readFile(path.join(root, IDLE_BRIDGE), "utf8"),
  );
  const flatBaseBackground = normalized(strFromU8(flatBaseBackgroundBytes));
  const idleLayer = withoutWrapperImport(
    strFromU8(wrappedBackgroundBytes),
  );
  const background = normalized(
    `${flatBaseBackground}\n\n// HF95: keep the proven HF90 worker at the root import depth and append the HF94 idle layer in the same service-worker file.\n${idleLayer}`,
  );
  new Function(background);
  new Function(idleBridge);
  entries[BACKGROUND] = strToU8(background);
  entries[IDLE_BRIDGE] = strToU8(idleBridge);

  let replacedIdleBridge = false;
  for (const script of manifest.content_scripts) {
    script.js = script.js.map((file) => {
      if (file !== BASE_IDLE_BRIDGE) return file;
      replacedIdleBridge = true;
      return IDLE_BRIDGE;
    });
  }
  if (!replacedIdleBridge) {
    throw new Error("shopling_stock_hf95_idle_bridge_entry_missing");
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF95";
  manifest.description =
    "HF95 flattens the proven worker and idle receipt into one service-worker file, then reports a bounded explicit failure if the background does not answer.";
  manifest.action.default_title =
    `Shopling 평탄화 백그라운드·IDLE 확인 v${VERSION} HF95`;
  entries["manifest.json"] = strToU8(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v098.js")'],
    ["background", background, "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT"],
    ["background", background, "STOCK_SYNC_GET_IDLE_STATUS_HF94"],
    ["background", background, "HF94_MINIMAL_IDLE_STATUS"],
    ["bridge", idleBridge, "HF95_IDLE_STATUS_RESPONSE_TIMEOUT"],
    ["bridge", idleBridge, "statusProbeOk: false"],
    ["bridge", idleBridge, "idleConfirmed: response.idleConfirmed === true"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf95_guard_missing:${label}:${guard}`);
    }
  }
  if (background.includes('importScripts("background-v099.js")')) {
    throw new Error("shopling_stock_hf95_nested_wrapper_not_flattened");
  }
  if ((background.match(/importScripts\(/g) || []).length !== 1) {
    throw new Error("shopling_stock_hf95_root_import_count_mismatch");
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf95_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256")
      .update(background)
      .digest("hex"),
    idleBridgeSha256: createHash("sha256")
      .update(idleBridge)
      .digest("hex"),
    baseZipSha256: createHash("sha256").update(baseZip).digest("hex"),
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        backgroundPolicy:
          "FLATTEN_HF90_AND_HF94_IN_ONE_SERVICE_WORKER_FILE",
        idlePolicy:
          "DEDICATED_MINIMAL_BACKGROUND_RECEIPT_WITH_TWO_SECOND_BRIDGE_TIMEOUT",
        liveLockPolicy:
          "FAIL_CLOSED_UNLESS_EXACT_TERMINAL_RECEIPT_MATCHES_ACTIVE_JOB",
        serialDispatchPolicy: "ONE_BCODE_AT_A_TIME_UNCHANGED",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.57-hf95.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-layout": "flattened-hf90-plus-hf94",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-idle-bridge-sha256": hashes.idleBridgeSha256,
    },
  });
}
