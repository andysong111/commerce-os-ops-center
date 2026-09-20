import { NextRequest, NextResponse } from "next/server";
import { loadLegacySeoShoplingEvidence } from "@/lib/legacySeoShoplingEvidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TOKEN = "temp-legacy-evidence-20260920-bd7c2a2f5e91";

function models(value: string) {
  return [...new Set(
    value.split(",")
      .map((item) => item.trim().toUpperCase().replace(/\s+/g, ""))
      .filter((item) => /^AAA[0-9]+(?:-[0-9]+)?$/.test(item)),
  )].slice(0, 20);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const requested = models(request.nextUrl.searchParams.get("models") ?? "");
  if (!requested.length) {
    return NextResponse.json({ ok: false, error: "MODELS_REQUIRED" }, { status: 400 });
  }
  try {
    const evidence = await loadLegacySeoShoplingEvidence(requested);
    const rows = requested.map((modelNumber) => {
      const item = evidence.get(modelNumber);
      return {
        modelNumber,
        source: item?.source ?? null,
        fetchedRowCount: item?.fetchedRowCount ?? 0,
        goodsKeys: item?.goodsKeys ?? [],
        optionGroups: (item?.optionGroups ?? []).map((group) => ({
          goodsKey: group.goodsKey,
          ptnGoodsCd: group.ptnGoodsCd,
          productName: group.productName,
          saleStatus: group.saleStatus,
          options: group.options.map((option) => ({
            optionId: option.optionId,
            optionName: option.optionName,
            bCode: option.bCode,
            optionBarcode: option.optionBarcode,
            status: option.status,
            quantity: option.quantity,
            amount: option.amount,
          })),
        })),
      };
    });
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
