import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf63Download } from "../download-hf63/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.26";
const VERSION = "0.6.27";
const HOTFIX = "HF64_SIMPLE_SERIAL_BCODE_AND_EXACT_A6_RESULT_FRAME";
const BASE_BACKGROUND = "background-v085.js";
const BACKGROUND = "background-v086.js";
const A6_EVIDENCE = "a6-frame-evidence-v086.js";
const LIST_WORKER = "content-shopling-v030.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf63Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND]) {
    throw new Error("shopling_stock_hf64_base_package_missing");
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
    throw new Error("shopling_stock_hf64_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, a6Evidence] = await Promise.all([
    readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
    readFile(path.join(root, A6_EVIDENCE), "utf8").then(normalized),
  ]);
  new Function(background);
  new Function(a6Evidence);
  entries[BACKGROUND] = strToU8(background);
  entries[A6_EVIDENCE] = strToU8(a6Evidence);

  const listWorkerEntry = manifest.content_scripts.find((script) =>
    script.js.includes(LIST_WORKER),
  );
  if (!listWorkerEntry) {
    throw new Error("shopling_stock_hf64_list_worker_entry_missing");
  }
  listWorkerEntry.js = [
    A6_EVIDENCE,
    ...listWorkerEntry.js.filter((file) => file !== A6_EVIDENCE),
  ];

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF64";
  manifest.description =
    "HF64 sends B-codes one at a time and follows the exact B-code result frame inside the dedicated A6 tab while preserving strict A21 write ownership.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF64`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf64_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256")
    .update(background)
    .digest("hex");
  const a6EvidenceSha256 = createHash("sha256")
    .update(a6Evidence)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        serialBcodeExecution: true,
        maxConcurrentDispatchLanes: 1,
        a6OwnerScope: "DEDICATED_TAB_BEST_EXACT_RESULT_FRAME",
        a6FrameEvidenceReadOnly: true,
        a21WriteOwnerHandoffAllowed: false,
        everySavedBcodeGetsIndependentAttempt: true,
        commerceOsTerminalBoundary:
          "EXACT_OWNER_A21_PROCESSING_SCREEN_OR_NESTED_RESULT_NAVIGATION",
        marketplaceCompletionRequired: false,
        backgroundSha256,
        a6EvidenceSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.27-hf64.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-serial-bcode-execution": "true",
      "x-stock-a6-owner-scope": "same-tab-exact-result-frame",
      "x-stock-a21-owner-handoff": "false",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-a6-evidence-sha256": a6EvidenceSha256,
    },
  });
}
