import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf62Download } from "../download-hf62/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.25";
const VERSION = "0.6.26";
const HOTFIX = "HF63_A6_OWNER_HANDOFF_AND_ALL_BCODE_ATTEMPTS";
const BASE_BACKGROUND = "background-v084.js";
const BACKGROUND = "background-v085.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf62Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes || !entries[BASE_BACKGROUND]) {
    throw new Error("shopling_stock_hf63_base_package_missing");
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
    throw new Error("shopling_stock_hf63_manifest_checkpoint_mismatch");
  }

  const background = await readFile(
    path.join(
      process.cwd(),
      "public",
      "shopling-stock-state-sync",
      BACKGROUND,
    ),
    "utf8",
  ).then(normalized);
  new Function(background);
  entries[BACKGROUND] = strToU8(background);
  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF63";
  manifest.description =
    "HF63 safely hands A6 ownership to the replacement frame after exact-search navigation and attempts every saved B-code even when its paired first job fails.";
  manifest.action.default_title =
    `Shopling 품절·판매중 동기화 v${VERSION} HF63`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf63_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const backgroundSha256 = createHash("sha256")
    .update(background)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        a6NavigationOwnerHandoff: "SAME_WORKER_TAB_AND_OLD_FRAME_GONE_ONLY",
        a21WriteOwnerHandoffAllowed: false,
        continueAfterFirstLaneFailure: true,
        everySavedBcodeGetsIndependentAttempt: true,
        commerceOsTerminalBoundary:
          "EXACT_OWNER_A21_PROCESSING_SCREEN_OR_NESTED_RESULT_NAVIGATION",
        marketplaceCompletionRequired: false,
        maxConcurrentDispatchLanes: 2,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.26-hf63.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-a6-navigation-owner-handoff": "safe-same-tab-only",
      "x-stock-continue-after-first-lane-failure": "true",
      "x-stock-every-bcode-attempted": "true",
      "x-stock-marketplace-completion-required": "false",
      "x-stock-background-sha256": backgroundSha256,
    },
  });
}
