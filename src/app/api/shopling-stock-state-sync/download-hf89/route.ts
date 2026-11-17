import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf88 } from "@/app/api/shopling-stock-state-sync/download-hf88/route";
import {
  patchHf89BackgroundHf84ExplicitHandoff,
  patchHf89CanonicalPopupHandoff,
} from "@/lib/shoplingStockHf89Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.51";
const VERSION = "0.6.52";
const HOTFIX = "HF89_EXACT_POPUP_TO_BLUE_SUBMIT_HANDOFF";
const BASE_BACKGROUND = "background-v097.js";
const BACKGROUND = "background-v098.js";
const HF84_BACKGROUND = "background-v095.js";
const CANONICAL_FILES = [
  "content-a21-canonical-v019.js",
  "content-a21-canonical-v020.js",
] as const;

export async function GET(request: Request) {
  const baseResponse = await getHf88(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf88"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf89_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const hf84BackgroundBytes = entries[HF84_BACKGROUND];
  if (!manifestBytes || !entries[BASE_BACKGROUND] || !hf84BackgroundBytes) {
    throw new Error("shopling_stock_hf89_base_file_missing");
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
    throw new Error("shopling_stock_hf89_manifest_checkpoint_mismatch");
  }

  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const background = (await readFile(path.join(root, BACKGROUND), "utf8")).replace(
    /\r\n?/g,
    "\n",
  );
  const patchedHf84Background = patchHf89BackgroundHf84ExplicitHandoff(
    strFromU8(hf84BackgroundBytes),
  );
  new Function(background);
  new Function(patchedHf84Background);
  entries[BACKGROUND] = strToU8(background);
  entries[HF84_BACKGROUND] = strToU8(patchedHf84Background);

  for (const file of CANONICAL_FILES) {
    const bytes = entries[file];
    if (!bytes) throw new Error(`shopling_stock_hf89_canonical_file_missing:${file}`);
    const patched = patchHf89CanonicalPopupHandoff(strFromU8(bytes));
    new Function(patched);
    entries[file] = strToU8(patched);
  }

  manifest.version = VERSION;
  manifest.background.service_worker = BACKGROUND;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF89";
  manifest.description =
    "HF89 hands the exact trusted-click popup directly to the proven blue submit engine, even when Chrome popup lifecycle events are missed.";
  manifest.action.default_title =
    `Shopling 정확 팝업·파란 전송 직접 인계 v${VERSION} HF89`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const canonical = strFromU8(entries[CANONICAL_FILES[1]]);
  const guards: Array<[string, string, string]> = [
    ["background", background, 'importScripts("background-v097.js")'],
    ["background", background, "A21_EXACT_POPUP_HANDOFF_HF89"],
    ["background", background, "__commerceOsHf84ExplicitPopupHandoff"],
    ["hf84", patchedHf84Background, "binding.claimedTabId = popupTabId"],
    ["hf84", patchedHf84Background, "await probeThenCommitHf84()"],
    ["hf84", patchedHf84Background, "HF89_EXACT_POPUP_BLUE_SUBMIT_COMMITTED"],
    ["canonical", canonical, "A21_EXACT_POPUP_HANDOFF_HF89"],
    ["canonical", canonical, "popupHandoffHf89?.committed !== true"],
  ];
  for (const [label, source, guard] of guards) {
    if (!source.includes(guard)) {
      throw new Error(`shopling_stock_hf89_guard_missing:${label}:${guard}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf89_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const hashes = {
    backgroundSha256: createHash("sha256").update(background).digest("hex"),
    hf84BackgroundSha256: createHash("sha256")
      .update(patchedHf84Background)
      .digest("hex"),
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
        redButtonBoundary: "TRUSTED_CLICK_EXACT_NEW_POPUP_ID",
        blueButtonPolicy: "EXACT_POPUP_ID_DIRECT_TO_PROVEN_HF84_COMMIT",
        stalePopupPolicy: "CLAIM_EXACT_NEW_POPUP_IGNORE_OLDER_WINDOWS",
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
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.52-hf89.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-popup-handoff": "exact-popup-id-to-blue-submit",
      "x-stock-background-sha256": hashes.backgroundSha256,
      "x-stock-hf84-background-sha256": hashes.hf84BackgroundSha256,
      "x-stock-canonical-sha256": hashes.canonicalSha256,
    },
  });
}
