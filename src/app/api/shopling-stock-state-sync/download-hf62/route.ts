import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf61Download } from "../download-hf61/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.24";
const VERSION = "0.6.25";
const HOTFIX = "HF62_EXACT_SEARCH_RESUME_AND_BATCH_CONTINUATION";
const BASE_BACKGROUND = "background-v083.js";
const BACKGROUND = "background-v084.js";
const LIST_WORKER = "content-shopling-v030.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf61Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const listWorkerBytes = entries[LIST_WORKER];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !listWorkerBytes) {
    throw new Error("shopling_stock_hf62_base_package_missing");
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
    throw new Error("shopling_stock_hf62_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [background, newPolicy] = await Promise.all([
    readFile(path.join(root, BACKGROUND), "utf8").then(normalized),
    readFile(path.join(root, "search-policy-v024.js"), "utf8").then(normalized),
  ]);
  const packagedListWorker = normalized(strFromU8(listWorkerBytes));
  const policyAssignment = packagedListWorker.indexOf("globalThis.CommerceStockSearchV023 =");
  const policyBoundary = packagedListWorker.indexOf("\n(() => {", policyAssignment);
  if (policyAssignment < 0 || policyBoundary < 0) {
    throw new Error("shopling_stock_hf62_search_policy_checkpoint_mismatch");
  }
  const oldPrefix = packagedListWorker.slice(0, policyBoundary + 1);
  if (
    !oldPrefix.includes("commerce-stock-search-v041:") ||
    !oldPrefix.includes("dateFieldDiagnostics") ||
    !oldPrefix.includes("const resumed = Boolean(ticket") ||
    oldPrefix.includes("commerce-stock-search-v042:") ||
    !newPolicy.includes("commerce-stock-search-v042:") ||
    !newPolicy.includes("dateFieldDiagnostics") ||
    newPolicy.includes("const resumed = Boolean(ticket")
  ) {
    throw new Error("shopling_stock_hf62_search_policy_checkpoint_mismatch");
  }
  const listWorker = `${newPolicy}${packagedListWorker.slice(oldPrefix.length)}`;
  new Function(background);
  new Function(listWorker);

  entries[BACKGROUND] = strToU8(background);
  entries[LIST_WORKER] = strToU8(listWorker);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF62";
  manifest.description =
    "HF62 resumes an execution-scoped exact search without clicking twice, ignores reload-only watchdog activity, and lets Commerce OS continue every B-code after an isolated failure.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF62`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf62_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  const listWorkerSha256 = createHash("sha256").update(listWorker).digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        exactSearchResumePolicy: "EXECUTION_SCOPED_SUBMITTED_TICKET_NO_RECLICK",
        reloadOnlyActivityIgnored: true,
        continueAfterIsolatedBcodeFailure: true,
        commerceOsTerminalBoundary:
          "EXACT_OWNER_A21_PROCESSING_SCREEN_OR_NESTED_RESULT_NAVIGATION",
        marketplaceCompletionRequired: false,
        maxConcurrentDispatchLanes: 2,
        backgroundSha256,
        listWorkerSha256,
        liveShoplingVerificationRequired: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.25-hf62.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-search-reclick-blocked": "true",
      "x-stock-batch-continue-after-isolated-failure": "true",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": backgroundSha256,
      "x-stock-list-worker-sha256": listWorkerSha256,
    },
  });
}
