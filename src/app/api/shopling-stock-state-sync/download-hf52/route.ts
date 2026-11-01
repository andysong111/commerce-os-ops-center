import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf51Download } from "../download-hf51/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.16";
const VERSION = "0.6.17";
const HOTFIX = "HF52_RECOVER_STALE_STARTING_FIRST";
const BACKGROUND_OLD = "background-v075.js";
const BACKGROUND_NEW = "background-v076.js";

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf51Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BACKGROUND_OLD]) {
    throw new Error("shopling_stock_hf52_required_entry_missing");
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
    manifest.background.service_worker !== BACKGROUND_OLD
  ) {
    throw new Error("shopling_stock_hf52_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = await readFile(path.join(root, BACKGROUND_NEW), "utf8");
  new Function(background);
  for (const guard of [
    "RECOVERING_FIRST_HF52",
    "STARTING_FIRST_STALE_MS",
    "state.jobs[0]?.jobId !== state.firstJobId",
    "await loadActive()",
    "await loadLastResult()",
    "const response = await start(state.jobs[0])",
    "shoplingMutationBeforeRecovery: false",
  ]) {
    if (!background.includes(guard)) {
      throw new Error(`shopling_stock_hf52_background_guard_missing:${guard}`);
    }
  }

  entries[BACKGROUND_NEW] = strToU8(background);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND_NEW;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF52";
  manifest.description =
    "HF52 safely resumes a stale STARTING_FIRST checkpoint only when no active job or terminal result exists, before any Shopling product mutation could have been dispatched.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF52`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf52_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundHash = createHash("sha256").update(background).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        staleCheckpoint: "STARTING_FIRST",
        recoveryRequiresNoActiveJob: true,
        recoveryRequiresNoTerminalResult: true,
        recoveryBeforeShoplingMutation: true,
        recoveryLease: true,
        incidentRegression:
          "BAE4_1_AND_BBC3_3_STARTED_BUT_BATCH_STALLED_IN_STARTING_FIRST_WITHOUT_ACTIVE_JOB",
        backgroundHash,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.17-hf52.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-background-sha256": backgroundHash,
    },
  });
}
