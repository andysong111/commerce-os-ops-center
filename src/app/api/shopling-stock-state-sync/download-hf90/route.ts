import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf89 } from "@/app/api/shopling-stock-state-sync/download-hf89/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.52";
const VERSION = "0.6.53";
const HOTFIX = "HF90_EXACT_POPUP_OWNER_RECEIPT_BRIDGE";
const BASE_BACKGROUND = "background-v098.js";
const BACKGROUND = "background-v099.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseResponse = await getHf89(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf89"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf90_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND]) {
    throw new Error("shopling_stock_hf90_base_file_missing");
  }

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
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf90_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(
    await readFile(path.join(root, BACKGROUND), "utf8"),
  );
  new Function(background);
  entries[BACKGROUND] = strToU8(background);

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF90";
  manifest.description =
    "HF90 binds HF89's exact trusted popup to the proven processing/result receipt watcher before the blue submit, preventing false failure and duplicate retry.";
  manifest.action.default_title =
    `Shopling 전송 영수증 정확 귀속 v${VERSION} HF90`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards = [
    'importScripts("background-v098.js")',
    "HF90_EXACT_TRUSTED_POPUP_HANDOFF",
    "HF90_EXACT_POPUP_BLUE_SUBMIT_COMMITTED_AND_OWNED",
    "active.workTabs.A21_POPUP",
    "externalWriteConfirmed: true",
    "retrySafe: false",
  ];
  for (const guard of guards) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf90_guard_missing:${guard}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf90_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256").update(background).digest("hex"),
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
        popupOwnership:
          "TRUSTED_EXACT_POPUP_PERSISTED_BEFORE_BLUE_SUBMIT",
        successReceipt:
          "PROVEN_HF60_HF72_PROCESSING_OR_RESULT_OWNER_CHAIN",
        committedRetryPolicy: "NO_AUTOMATIC_RETRY_AFTER_EXTERNAL_WRITE",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.53-hf90.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-owner-receipt": "exact-popup-before-blue-submit",
      "x-stock-background-sha256": hashes.backgroundSha256,
    },
  });
}
