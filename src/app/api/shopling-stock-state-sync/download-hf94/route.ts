import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf93 } from "@/app/api/shopling-stock-state-sync/download-hf93/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.55";
const VERSION = "0.6.56";
const HOTFIX = "HF94_DEDICATED_MINIMAL_IDLE_STATUS_HANDSHAKE";
const BASE_BACKGROUND = "background-v099.js";
const BACKGROUND = "background-v100.js";
const BASE_OPS = "content-ops-v025.js";
const IDLE_BRIDGE = "content-ops-idle-hf94.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf93(
    new Request(
      "http://commerce-os.local/api/shopling-stock-state-sync/download-hf93",
    ),
  );
  if (!baseResponse.ok) {
    throw new Error("shopling_stock_hf94_base_download_failed");
  }
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_OPS]) {
    throw new Error("shopling_stock_hf94_base_file_missing");
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
    throw new Error("shopling_stock_hf94_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(
    await readFile(path.join(root, BACKGROUND), "utf8"),
  );
  const idleBridge = normalized(
    await readFile(path.join(root, IDLE_BRIDGE), "utf8"),
  );
  new Function(background);
  new Function(idleBridge);
  entries[BACKGROUND] = strToU8(background);
  entries[IDLE_BRIDGE] = strToU8(idleBridge);

  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_OPS),
  );
  if (!opsEntry) throw new Error("shopling_stock_hf94_ops_entry_missing");
  const baseOpsIndex = opsEntry.js.indexOf(BASE_OPS);
  if (!opsEntry.js.includes(IDLE_BRIDGE)) {
    opsEntry.js.splice(baseOpsIndex + 1, 0, IDLE_BRIDGE);
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF94";
  manifest.description =
    "HF94 confirms extension idle through a dedicated minimal background receipt before each B-code and exposes exact probe failures without bypassing a live job lock.";
  manifest.action.default_title =
    `Shopling 다음 작업 가능 상태 전용 확인 v${VERSION} HF94`;
  entries["manifest.json"] = strToU8(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v099.js")'],
    ["background", background, "STOCK_SYNC_GET_IDLE_STATUS_HF94"],
    ["background", background, "HF94_MINIMAL_IDLE_STATUS"],
    ["background", background, "exactTerminalReceiptHf94"],
    ["bridge", idleBridge, "STOCK_SYNC_GET_IDLE_STATUS_HF94"],
    ["bridge", idleBridge, "statusProbeOk: false"],
    ["bridge", idleBridge, "idleConfirmed: response.idleConfirmed === true"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf94_guard_missing:${label}:${guard}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf94_missing_packaged_file:${file}`);
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
        idlePolicy:
          "DEDICATED_MINIMAL_BACKGROUND_RECEIPT_BEFORE_EACH_BCODE",
        liveLockPolicy:
          "FAIL_CLOSED_UNLESS_EXACT_TERMINAL_RECEIPT_MATCHES_ACTIVE_JOB",
        statusFailurePolicy:
          "EXPLICIT_PROBE_FAILURE_NEVER_TREATED_AS_IDLE",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.56-hf94.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-idle-receipt": "dedicated-minimal-background-probe",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-idle-bridge-sha256": hashes.idleBridgeSha256,
    },
  });
}
