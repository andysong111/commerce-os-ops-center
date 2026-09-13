import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as previousPackage } from "../../v0338/download/route";
import { buildReliableReadbackBulkV0339 } from "@/lib/shoplingMarketReliableReadbackBulkV0339";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const previous = await previousPackage();
  if (!previous.ok) throw new Error("v0339_previous_package_unavailable");
  const zipped = unzipSync(new Uint8Array(await previous.arrayBuffer()));
  const input = Object.fromEntries(
    Object.entries(zipped).map(([key, value]) => [key, strFromU8(value)]),
  );
  if (JSON.parse(input["manifest.json"]).version !== "0.3.38") {
    throw new Error("v0339_wrong_base");
  }
  const output = buildReliableReadbackBulkV0339(input);
  const buffer = zipSync(
    Object.fromEntries(Object.entries(output).map(([key, value]) => [key, strToU8(value)])),
    { level: 0 },
  );
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.39.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
