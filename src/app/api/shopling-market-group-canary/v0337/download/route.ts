import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GET as previousPackage } from "../../v0336/download/route";
import { buildRecoveryV0337 } from "@/lib/shoplingMarketRecoveryV0337";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const previous = await previousPackage();
  if (!previous.ok) throw new Error("v0337_previous_package_unavailable");
  const zipped = unzipSync(new Uint8Array(await previous.arrayBuffer()));
  const input = Object.fromEntries(Object.entries(zipped).map(([key, value]) => [key, strFromU8(value)]));
  if (JSON.parse(input["manifest.json"]).version !== "0.3.36") throw new Error("v0337_wrong_base");
  const assetRoot = path.join(process.cwd(), "public/shopling-market-sender-v0337");
  const assets = {
    recovery: await readFile(path.join(assetRoot, "recovery.mjs"), "utf8"),
    preprod: await readFile(path.join(assetRoot, "preprod.txt"), "utf8"),
    background: await readFile(path.join(assetRoot, "background-extra.txt"), "utf8"),
    popup: await readFile(path.join(assetRoot, "popup-extra.txt"), "utf8"),
  };
  const output = buildRecoveryV0337(input, assets);
  const buffer = zipSync(Object.fromEntries(Object.entries(output).map(([key, value]) => [key, strToU8(value)])), { level: 0 });
  return new Response(Buffer.from(buffer), { headers: {
    "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.37.zip",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
