import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadLegacySeoShoplingEvidence } from "@/lib/legacySeoShoplingEvidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const EXPECTED_TOKEN_SHA256 = "95d0cd6edeefbed4cd9bff95472e06a3f1aa56743e801ecb4c15d8a142061acb";
const MODELS = ["AAA129", "AAA369", "AAA378"] as const;

function authorized(token: string) {
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(EXPECTED_TOKEN_SHA256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!authorized(token)) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
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
