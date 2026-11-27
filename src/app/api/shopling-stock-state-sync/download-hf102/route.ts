import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getHf101 } from "@/app/api/shopling-stock-state-sync/download-hf101/route";
import { patchMarketPlanGrouping, patchMarketPlanOps, patchMarketResultWatcher } from "@/lib/shoplingStockHf102Patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = await getHf101(new Request("http://commerce-os.local/api/shopling-stock-state-sync/download-hf101"));
  if (!base.ok) throw new Error("shopling_hf102_base_download_failed");
  const entries = unzipSync(new Uint8Array(await base.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (manifest.version !== "0.6.61" || manifest.background.service_worker !== "background-v101.js") {
    throw new Error("shopling_hf102_manifest_checkpoint_mismatch");
  }
  const root = path.join(process.cwd(), "public", "shopling-stock-state-sync");
  const [helpers, receipts] = await Promise.all([
    readFile(path.join(root, "market-plan-hf102.js"), "utf8"),
    readFile(path.join(root, "market-receipts-hf102.js"), "utf8"),
  ]);
  const files = {
    "background-v092.js": patchMarketPlanGrouping(strFromU8(entries["background-v092.js"]), helpers),
    "background-v097.js": patchMarketResultWatcher(strFromU8(entries["background-v097.js"])),
    "background-v101.js": strFromU8(entries["background-v101.js"]) + "\n" + receipts,
    "content-ops-v025.js": patchMarketPlanOps(strFromU8(entries["content-ops-v025.js"])),
  };
  for (const [name, source] of Object.entries(files)) {
    new Function(source);
    entries[name] = strToU8(source);
  }
  manifest.version = "0.6.62";
  manifest.name = "Commerce OS · Shopling Stock State Sync HF102";
  manifest.description = "옵션 전송과 상품 판매상태 전송을 순서대로 실행하고 각 팝업의 원본 접수를 확인합니다.";
  manifest.action.default_title = "Shopling 상품·옵션 상태 전송 v0.6.62";
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");
  const zip = zipSync(entries, { level: 9, mtime: new Date(2026, 10, 27) });
  if (new URL(request.url).searchParams.get("verify") === "1") {
    return Response.json({
      ok: true, version: manifest.version, baseVersion: "0.6.61", planVersion: 2,
      zipBytes: zip.byteLength, sha256: createHash("sha256").update(zip).digest("hex"),
    }, { headers: { "cache-control": "no-store" } });
  }
  return new Response(zip, { headers: {
    "content-type": "application/zip", "cache-control": "no-store",
    "content-disposition": 'attachment; filename="commerce-os-shopling-stock-state-v0.6.62-hf102.zip"',
    "x-content-type-options": "nosniff",
  } });
}
