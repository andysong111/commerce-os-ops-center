import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf80BackgroundSource } from "@/lib/shoplingStockHf80Patch";
import { GET as getHf79Download } from "../download-hf79/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.42";
const VERSION = "0.6.43";
const HOTFIX = "HF80_AGGREGATE_OPTION_STATE_AND_STAGED_A21_TRANSMISSION";
const GROUPED_BACKGROUND = "background-v092.js";

type Manifest = {
  manifest_version: number;
  version: string;
  name?: string;
  description?: string;
  background: { service_worker: string };
  action: { default_title?: string; default_popup: string };
  content_scripts: Array<{ js: string[] }>;
};

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf79Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  const backgroundBytes = entries[GROUPED_BACKGROUND];
  if (!manifestBytes || !backgroundBytes) {
    throw new Error("shopling_stock_hf80_base_file_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf80_manifest_checkpoint_mismatch");
  }

  const groupedBackground = patchHf80BackgroundSource(
    normalized(strFromU8(backgroundBytes)),
  );
  new Function(groupedBackground);
  for (const guard of [
    "SHOPLING_HF80_STEP_SEQUENCE_INVALID",
    'for (const transmissionKind of ["PRODUCT_SALE_STATUS_SEND", "OPTION_SEND"])',
    "stockStateTransmissionGroupsHf72: groups",
  ]) {
    if (!groupedBackground.includes(guard)) {
      throw new Error(`shopling_stock_hf80_guard_missing:${guard}`);
    }
  }
  entries[GROUPED_BACKGROUND] = strToU8(groupedBackground);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF80";
  manifest.description =
    "HF80 uses aggregate option state: the final sold-out option sends product sold-out, while partial recovery sends product on-sale before option transmission. It preserves HF69 visible A21 radio clicks and HF79 current-host popup ownership.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF80`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf80_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const groupedBackgroundSha256 = createHash("sha256")
    .update(groupedBackground)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        stockStateRule:
          "FULL_SOLD_OUT_PRODUCT_LANE_AND_PARTIAL_RECOVERY_PRODUCT_THEN_OPTION",
        stagedTransmission:
          "PRODUCT_SALE_STATUS_SEND_BEFORE_OPTION_SEND_WHEN_RECOVERING",
        visibleA21ClickBaseline: "HF69_PRESERVED",
        popupOwnershipBaseline: "HF79_PRESERVED",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        marketplaceCompletionRequired: false,
        liveShoplingVerificationRequired: true,
        groupedBackgroundSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.43-hf80.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-grouped-background-sha256": groupedBackgroundSha256,
    },
  });
}
