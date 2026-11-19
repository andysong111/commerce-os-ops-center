import { saveLegacySeoInventoryBundleUnits } from "@/lib/legacySeoInventoryCatalog";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const B_CODE = /^B[A-Z]{2}\d+-\d+$/;

function normalizeUpdates(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new Error("FREIGHT_BUNDLE_UNIT_UPDATES_INVALID");
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const barcode = String(row.barcode ?? "")
      .normalize("NFKC")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const bundleUnit = Number(row.bundleUnit);
    const parsedAt = Date.parse(String(row.updatedAt ?? ""));
    if (
      !B_CODE.test(barcode) ||
      !Number.isSafeInteger(bundleUnit) ||
      bundleUnit < 1 ||
      bundleUnit > 9_999 ||
      !Number.isFinite(parsedAt) ||
      seen.has(barcode)
    ) {
      throw new Error(`FREIGHT_BUNDLE_UNIT_UPDATE_INVALID:${barcode}`);
    }
    seen.add(barcode);
    return {
      barcode,
      bundleUnit,
      updatedAt: new Date(parsedAt).toISOString(),
    };
  });
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, message: "Ops Center 동일 출처 화면에서만 소분단위를 저장할 수 있습니다." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { updates?: unknown };
    const updates = normalizeUpdates(body.updates);
    const stored = await saveLegacySeoInventoryBundleUnits(updates);
    return Response.json(
      { ok: true, savedCount: stored.length, updates: stored },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "상품마스터 소분단위 저장에 실패했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
