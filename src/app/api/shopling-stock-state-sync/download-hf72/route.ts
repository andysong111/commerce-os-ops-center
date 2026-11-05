import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  patchHf72LegacyProcessingObserverSource,
  patchHf72LegacyResultNavigationObserverSource,
  patchHf72OptionClaimSource,
  patchHf72PopupPreflightSource,
  patchHf72ResultObserverSource,
  patchHf72SingleClaimSource,
} from "@/lib/shoplingStockHf72Patch";
import { GET as getHf71Download } from "../download-hf71/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.34";
const VERSION = "0.6.35";
const HOTFIX = "HF72_GROUPED_GOODS_KEYS_AND_RESILIENT_POPUP_COMPLETION";
const BASE_BACKGROUND = "background-v091.js";
const BACKGROUND = "background-v092.js";
const OPTION_CLAIM = "background-v050.js";
const SINGLE_CLAIM = "background-v059.js";
const POPUP_PREFLIGHT = "background-v077-hf58.js";
const LEGACY_RESULT_NAV_OBSERVER = "background-v079.js";
const LEGACY_PROCESSING_OBSERVER = "background-v081.js";
const RESULT_OBSERVER = "background-v082.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const baseUrl = new URL(request.url);
  baseUrl.searchParams.delete("verify");
  const baseResponse = await getHf71Download(
    new Request(baseUrl.toString(), { headers: request.headers }),
  );
  if (!baseResponse.ok) return baseResponse;

  const entries = unzipSync(new Uint8Array(await baseResponse.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  for (const file of [
    BASE_BACKGROUND,
    OPTION_CLAIM,
    SINGLE_CLAIM,
    POPUP_PREFLIGHT,
    LEGACY_RESULT_NAV_OBSERVER,
    LEGACY_PROCESSING_OBSERVER,
    RESULT_OBSERVER,
  ]) {
    if (!entries[file]) throw new Error(`shopling_stock_hf72_base_file_missing:${file}`);
  }
  if (!manifestBytes) throw new Error("shopling_stock_hf72_manifest_missing");
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
    throw new Error("shopling_stock_hf72_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = normalized(await readFile(path.join(root, BACKGROUND), "utf8"));
  const optionClaim = patchHf72OptionClaimSource(
    normalized(strFromU8(entries[OPTION_CLAIM])),
  );
  const singleClaim = patchHf72SingleClaimSource(
    normalized(strFromU8(entries[SINGLE_CLAIM])),
  );
  const popupPreflight = patchHf72PopupPreflightSource(
    normalized(strFromU8(entries[POPUP_PREFLIGHT])),
  );
  const legacyResultNavigationObserver =
    patchHf72LegacyResultNavigationObserverSource(
      normalized(strFromU8(entries[LEGACY_RESULT_NAV_OBSERVER])),
    );
  const legacyProcessingObserver = patchHf72LegacyProcessingObserverSource(
    normalized(strFromU8(entries[LEGACY_PROCESSING_OBSERVER])),
  );
  const resultObserver = patchHf72ResultObserverSource(
    normalized(strFromU8(entries[RESULT_OBSERVER])),
  );

  for (const source of [
    background,
    optionClaim,
    singleClaim,
    popupPreflight,
    legacyResultNavigationObserver,
    legacyProcessingObserver,
    resultObserver,
  ]) {
    new Function(source);
  }

  entries[BACKGROUND] = strToU8(background);
  entries[OPTION_CLAIM] = strToU8(optionClaim);
  entries[SINGLE_CLAIM] = strToU8(singleClaim);
  entries[POPUP_PREFLIGHT] = strToU8(popupPreflight);
  entries[LEGACY_RESULT_NAV_OBSERVER] = strToU8(legacyResultNavigationObserver);
  entries[LEGACY_PROCESSING_OBSERVER] = strToU8(legacyProcessingObserver);
  entries[RESULT_OBSERVER] = strToU8(resultObserver);

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF72";
  manifest.description =
    "HF72 groups API-classified goods keys into compatible A21 transmissions of up to 200, safely claims the unique fresh Shopling popup even when its intermediary opener closes, and completes each group at the processing/result screen boundary.";
  manifest.action.default_title =
    `Shopling 품절·판매중 API 우선 일괄동기화 v${VERSION} HF72`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v091.js")'],
    ["background", background, "GROUP_BY_TRANSMISSION_KIND_UP_TO_200"],
    ["background", background, "stockStateTransmissionGroupsHf72"],
    ["background", background, "BATCH_MAX_V092 = 200"],
    ["background", background, "shoplingResultBaselineBatchKeyHf72"],
    ["background", background, "stockStateAcceptedPopupTabIdsHf72"],
    ["optionClaim", optionClaim, "fresh.length !== 1"],
    ["optionClaim", optionClaim, "if (!opener) return true"],
    ["singleClaim", singleClaim, "fresh.length !== 1"],
    ["popupPreflight", popupPreflight, "acceptedPopupTabIdsHf72"],
    ["popupPreflight", popupPreflight, "EXACT_OPENER_TAB_WITH_ACCEPTED_HANDOFF_HF72"],
    ["legacyResultNavigationObserver", legacyResultNavigationObserver, "const groupedActive = await loadActive()"],
    ["legacyResultNavigationObserver", legacyResultNavigationObserver, "stockStateTransmissionGroupsHf72"],
    ["legacyProcessingObserver", legacyProcessingObserver, "stockStateTransmissionGroupsHf72"],
    ["resultObserver", resultObserver, "PERSISTED_CLAIMED_POPUP_HF72"],
    ["resultObserver", resultObserver, "shoplingResultBaselineTabIdsHf72"],
    ["resultObserver", resultObserver, "SHOPLING_PROCESSING_OR_RESULT_ACCEPTED_HF72"],
    ["resultObserver", resultObserver, "continueNextGoodsKey("],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf72_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf72_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = Object.fromEntries(
    Object.entries({
      background,
      optionClaim,
      singleClaim,
      popupPreflight,
      legacyResultNavigationObserver,
      legacyProcessingObserver,
      resultObserver,
    }).map(
      ([key, source]) => [
        `${key}Sha256`,
        createHash("sha256").update(source).digest("hex"),
      ],
    ),
  );
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        goodsKeyDispatch: "GROUPED_BY_TRANSMISSION_KIND_UP_TO_200",
        transmissionGroups: ["OPTION_SEND", "PRODUCT_SALE_STATUS_SEND"],
        popupOwnership:
          "UNIQUE_FRESH_EXACT_POPUP_WITH_DIRECT_MISSING_OR_CLOSED_INTERMEDIATE_OPENER",
        completionBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP",
        resultAcceptance: "CURRENT_GROUP_BATCH_RESULT_BASELINE",
        acceptedPopupHandoff: "EXACT_ACCEPTED_POPUP_IGNORED_BY_NEXT_GROUP_PREFLIGHT",
        marketplaceCompletionRequired: false,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.35-hf72.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-goods-key-dispatch": "grouped-by-compatible-mode-up-to-200",
      "x-stock-popup-ownership": "unique-fresh-resilient-opener-chain",
      "x-stock-background-sha256": String(hashes.backgroundSha256),
    },
  });
}
