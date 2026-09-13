import { NextResponse } from "next/server";
import { loadLegacySeoShoplingEvidence } from "@/lib/legacySeoShoplingEvidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODELS = ["AAA129", "AAA369", "AAA378"] as const;

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ ok: false, error: "PREVIEW_ONLY" }, { status: 404 });
  }

  try {
    const evidence = await loadLegacySeoShoplingEvidence([...MODELS]);
    const rows = MODELS.map((modelNumber) => {
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
          salePrice: group.salePrice,
          originalPrice: group.originalPrice,
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
