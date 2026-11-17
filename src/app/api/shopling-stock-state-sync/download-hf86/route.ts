import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { patchHf86CanonicalListSource } from "@/lib/shoplingStockHf86Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.48";
const VERSION = "0.6.49";
const HOTFIX = "HF86_TRUSTED_A21_LIST_CLICK_AND_POPUP_RECEIPT";
const BASE_ZIP = "fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip";
const BASE_BACKGROUND = "background-v095.js";
const BACKGROUND = "background-v096.js";
const BASE_CANONICAL = "content-a21-canonical-v019.js";
const CANONICAL = "content-a21-canonical-v020.js";

function normalized(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

export async function GET(request: Request) {
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [baseZip, backgroundBytes] = await Promise.all([
    readFile(path.join(root, BASE_ZIP)),
    readFile(path.join(root, BACKGROUND)),
  ]);
  const entries = unzipSync(new Uint8Array(baseZip));
  const manifestBytes = entries["manifest.json"];
  const canonicalBytes = entries[BASE_CANONICAL];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !canonicalBytes) {
    throw new Error("shopling_stock_hf86_base_file_missing");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{
      matches: string[];
      exclude_matches?: string[];
      js: string[];
      all_frames?: boolean;
      run_at?: string;
      world?: string;
    }>;
  };
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== BASE_VERSION ||
    manifest.background.service_worker !== BASE_BACKGROUND
  ) {
    throw new Error("shopling_stock_hf86_manifest_checkpoint_mismatch");
  }

  const canonical = patchHf86CanonicalListSource(strFromU8(canonicalBytes));
  const background = normalized(backgroundBytes.toString("utf8"));
  new Function(canonical);
  new Function(background);

  // Keep v019 patched because HF85's prepared-worker bootstrap can inject that
  // exact filename after a page reload. The manifest starts v020 directly.
  entries[BASE_CANONICAL] = strToU8(canonical);
  entries[CANONICAL] = strToU8(canonical);
  entries[BACKGROUND] = strToU8(background);

  const canonicalEntry = manifest.content_scripts.find((script) =>
    script.js.includes(BASE_CANONICAL),
  );
  if (!canonicalEntry) {
    throw new Error("shopling_stock_hf86_canonical_entry_missing");
  }
  canonicalEntry.js = canonicalEntry.js.map((file) =>
    file === BASE_CANONICAL ? CANONICAL : file,
  );

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF86";
  manifest.description =
    "HF86 clicks Shopling's red A21 list action with a trusted CDP mouse event and reports success only after the real modify-send popup is observed.";
  manifest.action.default_title =
    `Shopling A21 신뢰 클릭·실제 팝업 확인 v${VERSION} HF86`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v095.js")'],
    ["background", background, '"Input.dispatchMouseEvent"'],
    ["background", background, "HF86_TRUSTED_CLICK_POPUP_CONFIRMED"],
    ["background", background, "baseline.has(id)"],
    ["canonical", canonical, 'type: "A21_TRUSTED_MODIFY_SEND_CLICK_HF86"'],
    ["canonical", canonical, "response?.trustedClick === true"],
    ["canonical", canonical, "response?.popupObserved === true"],
    ["canonical", canonical, "const modifySend = await clickModifySend(assignment);"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf86_guard_missing:${label}:${guard}`);
    }
  }

  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf86_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256").update(background).digest("hex"),
    canonicalSha256: createHash("sha256").update(canonical).digest("hex"),
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
        baseZipBytes: baseZip.byteLength,
        listActionClick: "CHROME_DEBUGGER_TRUSTED_MOUSE_EVENT",
        clickSuccessBoundary: "EXACT_NEW_SHOPLING_MODIFY_SEND_POPUP_OBSERVED",
        legacySyntheticClickAccepted: false,
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.49-hf86.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-list-click": "cdp-trusted-mouse-event",
      "x-stock-click-success-boundary": "exact-new-popup-observed",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-canonical-sha256": hashes.canonicalSha256,
    },
  });
}
