import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf87 } from "@/app/api/shopling-stock-state-sync/download-hf87/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.6.50";
const VERSION = "0.6.51";
const HOTFIX = "HF88_PREVIEW_ORIGIN_BRIDGE";
const OPS_SCRIPT = "content-ops-v025.js";
const LEGACY_BACKGROUND = "background-v020.js";
const PRODUCTION_MATCH = "https://commerce-os-ops-center.vercel.app/*";
const PREVIEW_MATCHES = [
  "https://commerce-os-ops-center-8eexmqzlu-a2bsangsa.vercel.app/*",
  "https://commerce-os-ops-center-git-codex-shopling-stoc-d84729-a2bsangsa.vercel.app/*",
];

export async function GET(request: Request) {
  const baseResponse = await getHf87(
    new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf87"),
  );
  if (!baseResponse.ok) throw new Error("shopling_stock_hf88_base_download_failed");
  const baseZip = new Uint8Array(await baseResponse.arrayBuffer());
  const entries = unzipSync(baseZip);
  const manifestBytes = entries["manifest.json"];
  const legacyBackgroundBytes = entries[LEGACY_BACKGROUND];
  if (!manifestBytes || !legacyBackgroundBytes) {
    throw new Error("shopling_stock_hf88_base_file_missing");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    manifest_version: number;
    version: string;
    name?: string;
    description?: string;
    host_permissions?: string[];
    background: { service_worker: string };
    action: { default_title?: string; default_popup: string };
    content_scripts: Array<{ js: string[]; matches: string[] }>;
  };
  if (manifest.manifest_version !== 3 || manifest.version !== BASE_VERSION) {
    throw new Error("shopling_stock_hf88_manifest_checkpoint_mismatch");
  }

  manifest.host_permissions = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions
    : [];
  for (const match of PREVIEW_MATCHES) {
    if (!manifest.host_permissions.includes(match)) manifest.host_permissions.push(match);
  }
  const opsEntry = manifest.content_scripts.find((script) =>
    script.js.includes(OPS_SCRIPT),
  );
  if (!opsEntry || !opsEntry.matches.includes(PRODUCTION_MATCH)) {
    throw new Error("shopling_stock_hf88_ops_entry_missing");
  }
  for (const match of PREVIEW_MATCHES) {
    if (!opsEntry.matches.includes(match)) opsEntry.matches.push(match);
  }

  const legacyBackground = strFromU8(legacyBackgroundBytes);
  const oldDeclaration = `const OPS_MATCH = "${PRODUCTION_MATCH}";`;
  if (!legacyBackground.includes(oldDeclaration)) {
    throw new Error("shopling_stock_hf88_ops_match_checkpoint_missing");
  }
  const opsMatches = [PRODUCTION_MATCH, ...PREVIEW_MATCHES];
  const patchedBackground = legacyBackground.replace(
    oldDeclaration,
    `const OPS_MATCH = ${JSON.stringify(opsMatches)};`,
  );
  new Function(patchedBackground);
  entries[LEGACY_BACKGROUND] = strToU8(patchedBackground);

  manifest.version = VERSION;
  manifest.name = "Commerce OS · Shopling Stock State Sync HF88";
  manifest.description =
    "HF88 keeps HF87 grouped transmission and permits the isolated Commerce OS preview origin used for live verification.";
  manifest.action.default_title =
    `Shopling 동일모델 묶음·미리보기 연결 v${VERSION} HF88`;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  for (const match of PREVIEW_MATCHES) {
    if (!manifest.host_permissions.includes(match) || !opsEntry.matches.includes(match)) {
      throw new Error(`shopling_stock_hf88_preview_match_missing:${match}`);
    }
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]) {
    if (!entries[file]) {
      throw new Error(`shopling_stock_hf88_missing_packaged_file:${file}`);
    }
  }

  const zip = zipSync(entries, { level: 9 });
  const manifestSha256 = createHash("sha256")
    .update(entries["manifest.json"])
    .digest("hex");
  const bridgeSha256 = createHash("sha256")
    .update(patchedBackground)
    .digest("hex");
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json(
      {
        ok: true,
        version: VERSION,
        baseVersion: BASE_VERSION,
        hotfix: HOTFIX,
        zipBytes: zip.byteLength,
        previewMatches: PREVIEW_MATCHES,
        productionMatch: PRODUCTION_MATCH,
        sameModelApiPolicy: "APPLY_ALL_THEN_ONE_A21_SEND",
        resultReceipt: "STABLE_BALANCED_SHOPLING_RESULT_TABLE",
        manifestSha256,
        bridgeSha256,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="commerce-os-shopling-stock-state-v0.6.51-hf88.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-stock-hotfix": HOTFIX,
      "x-stock-preview-bridge": "enabled",
      "x-stock-manifest-sha256": manifestSha256,
      "x-stock-bridge-sha256": bridgeSha256,
    },
  });
}
