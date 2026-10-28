import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as previousPackage } from "../../v0343/download/route";
import { buildBridgeManifestV0344 } from "@/lib/shoplingMarketBridgeManifestV0344";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const previous = await previousPackage();
  if (!previous.ok) throw new Error("v0344_previous_package_unavailable");
  const zipped = unzipSync(new Uint8Array(await previous.arrayBuffer()));
  const input = Object.fromEntries(
    Object.entries(zipped).map(([key, value]) => [key, strFromU8(value)]),
  );
  const output = buildBridgeManifestV0344(input);
  const buffer = zipSync(
    Object.fromEntries(
      Object.entries(output).map(([key, value]) => [key, strToU8(value)]),
    ),
    { level: 0 },
  );
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        "attachment; filename=commerce-os-shopling-market-sender-v0.3.44.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
