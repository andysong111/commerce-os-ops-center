import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf86 } from "@/app/api/shopling-stock-state-sync/download-hf86/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.49";
const VERSION = "0.6.50";
const HOTFIX = "HF87_COALESCED_MODEL_API_AND_BALANCED_RESULT_RECEIPT";
const BASE_BACKGROUND = "background-v096.js";
const BACKGROUND = "background-v097.js";
const BASE_OPS = "content-ops-v024.js";
const OPS = "content-ops-v025.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf86(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf86"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf87_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !entries[BASE_OPS]) {
    throw new Error("shopling_stock_hf87_base_file_missing");
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
    throw new Error("shopling_stock_hf87_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [backgroundBytes, opsBytes] = await Promise.all([
    readFile(path.join(root, BACKGROUND)),
    readFile(path.join(root, OPS)),
  ]);
  const background = normalized(backgroundBytes.toString("utf8"));
  const ops = normalized(opsBytes.toString("utf8"));
  new Function(background);
  new Function(ops);
  entries[BACKGROUND] = strToU8(background);
  entries[OPS] = strToU8(ops);

  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_OPS),
  );
  if (!opsEntry) throw new Error("shopling_stock_hf87_ops_entry_missing");
  opsEntry.js = opsEntry.js.map((file) => (file === BASE_OPS ? OPS : file));

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF87";
  manifest.description =
    "HF87 applies same-model option B-codes before one A21 send and accepts a stable balanced Shopling result table as the final receipt.";
  manifest.action.default_title =
    `Shopling 동일모델 묶음·성공표 영수증 v${VERSION} HF87`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v096.js")'],
    ["background", background, "HF87_STABLE_BALANCED_SHOPLING_RESULT_TABLE"],
    ["background", background, "processingOverlayPresent"],
    ["background", background, "rowsBalanced"],
    ["ops", ops, "stockStateCoalescedJobsHf87"],
    ["ops", ops, "SHOPLING_STOCK_STATE_COALESCED_API_FAILED"],
    ["ops", ops, "동일 모델 B코드"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf87_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf87_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256").update(background).digest("hex"),
    opsSha256: createHash("sha256").update(ops).digest("hex"),
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
        sameModelApiPolicy: "APPLY_ALL_THEN_ONE_A21_SEND",
        resultReceipt: "STABLE_BALANCED_SHOPLING_RESULT_TABLE",
        staleProcessingOverlayBlocksSuccess: false,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.50-hf87.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-same-model-policy": "apply-all-then-one-a21-send",
      "x-stock-result-receipt": "stable-balanced-result-table",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-ops-sha256": hashes.opsSha256,
    },
  });
}
