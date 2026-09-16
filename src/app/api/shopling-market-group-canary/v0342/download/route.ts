import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as previousPackage } from "../../v0341/download/route";
import { buildOneClickIntentV0342 } from "@/lib/shoplingMarketOneClickIntentV0342";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const previous = await previousPackage();
  if (!previous.ok) throw new Error("v0342_previous_package_unavailable");
  const zipped = unzipSync(new Uint8Array(await previous.arrayBuffer()));
  const input = Object.fromEntries(
    Object.entries(zipped).map(([key, value]) => [key, strFromU8(value)]),
  );
  if (JSON.parse(input["manifest.json"]).version !== "0.3.41") {
    throw new Error("v0342_wrong_base");
  }
  const output = buildOneClickIntentV0342(input);
  const buffer = zipSync(
    Object.fromEntries(Object.entries(output).map(([key, value]) => [key, strToU8(value)])),
    { level: 0 },
  );
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.42.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
