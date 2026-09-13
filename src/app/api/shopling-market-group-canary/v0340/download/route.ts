import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as previousPackage } from "../../v0339/download/route";
import { buildA18FrameStartV0340 } from "@/lib/shoplingMarketA18FrameStartV0340";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const previous = await previousPackage();
  if (!previous.ok) throw new Error("v0340_previous_package_unavailable");
  const zipped = unzipSync(new Uint8Array(await previous.arrayBuffer()));
  const input = Object.fromEntries(
    Object.entries(zipped).map(([key, value]) => [key, strFromU8(value)]),
  );
  if (JSON.parse(input["manifest.json"]).version !== "0.3.39") {
    throw new Error("v0340_wrong_base");
  }
  const output = buildA18FrameStartV0340(input);
  const buffer = zipSync(
    Object.fromEntries(Object.entries(output).map(([key, value]) => [key, strToU8(value)])),
    { level: 0 },
  );
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.40.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
