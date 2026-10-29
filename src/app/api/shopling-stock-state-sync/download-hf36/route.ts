import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf35Download } from "../download-hf35/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.3";
const VERSION = "0.6.4";
const HOTFIX = "HF36_EXACT_TAB_FRAME_RESULT_OWNERSHIP";
const BACKGROUND_OLD = "background-v072.js";
const BACKGROUND_NEW = "background-v073.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf35Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("shopling_stock_hf36_manifest_missing");

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
    throw new Error("shopling_stock_hf36_manifest_version_mismatch");
  }
  if (manifest.background.service_worker !== BACKGROUND_OLD) {
    throw new Error("shopling_stock_hf36_hf35_checkpoint_missing");
  }

  for (const guard of [
    "matchesAssignedTargetV073",
    "target.frameId === sender?.frameId",
    "STOCK_SYNC_UNASSIGNED_FRAME_IGNORED_HF36",
    "belongsToActiveJob",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf36_frame_guard_missing:${guard}`);
    }
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF36";
  manifest.description =
    "HF36 accepts A6/A21 page-ready and step-result messages only from the exact tab and frame assigned during preflight, preventing a duplicate Shopling frame from recording a false failure after the assigned frame succeeds.";
  manifest.action.default_title = `Shopling 품절·판매중 동기화 v${VERSION} HF36`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const required of [BACKGROUND_OLD, BACKGROUND_NEW]) {
    if (!entries[required]) {
      throw new Error(`shopling_stock_hf36_checkpoint_missing:${required}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf36_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        exactAssignedTabRequired: true,
        exactAssignedFrameRequired: true,
        unassignedPageReadyIgnored: true,
        unassignedStepResultIgnored: true,
        incidentRegression:
          "BCB6-2_EIGHT_OPTIONS_SUCCEEDED_WHILE_UNASSIGNED_FRAME_REPORTED_DATE_AMBIGUOUS",
        hf35DateAndProductRowGuardsPreserved: true,
        background: BACKGROUND_NEW,
        backgroundSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.4-hf36.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-exact-frame-ownership": "true",
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
