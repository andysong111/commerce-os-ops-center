import { randomUUID } from "node:crypto";
import { monthlyValidateObservation, reviewMonthlyLinkedMarketPrices, verifyMonthlyPricePlan } from "@/lib/monthlyPriceCore";
import { readMonthlyLiveProduct } from "@/lib/monthlyPriceShopling";
import { withMonthlyPriceItem, auditMonthlyPrice } from "@/lib/monthlyPriceStore";

function validId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("MONTHLY_PRICE_ID_INVALID");
  }
  return value;
}

function response(item: {
  id: string;
  state: string;
  error_code: string | null;
  write_index: number;
  transmission: unknown;
  plan: unknown;
}) {
  return {
    id: item.id,
    state: item.state,
    errorCode: item.error_code,
    writeIndex: item.write_index,
    transmission: item.transmission,
    plan: item.plan,
  };
}

export async function reviewLegacyMonthlyTransmission(payload: Record<string, unknown>) {
  const itemId = validId(payload.itemId);
  const runId = validId(payload.runId);
  const nextBatchId = validId(payload.nextBatchId);

  return withMonthlyPriceItem(itemId, runId, async (item) => {
    if (
      item.state !== "RESENDING" ||
      item.error_code !== "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED" ||
      !item.plan ||
      !item.transmission ||
      item.transmission.batchId
    ) {
      return { ...response(item), marketReview: null, requeued: false };
    }

    const observed = monthlyValidateObservation(payload.observation, item.goods_key);
    const live = await readMonthlyLiveProduct(item.goods_key);
    verifyMonthlyPricePlan(item.plan, item.candidate, live, observed);
    const review = reviewMonthlyLinkedMarketPrices(item.plan, observed);

    if (review.state === "MATCHED") {
      item.state = "TRANSMITTED";
      item.error_code = null;
      item.transmission = {
        ...item.transmission,
        finishedAt: new Date().toISOString(),
        result: "LINKED_MARKET_PRICE_VERIFIED",
      };
      await auditMonthlyPrice(item, "LEGACY_MARKET_PRICE_VERIFIED", {
        expectedMallCount: review.expectedMallCount,
        sellingMallCount: review.sellingMallCount,
        matchedMallKeys: review.matchedMallKeys,
        inactiveMallKeys: review.inactiveMallKeys,
      });
      return { ...response(item), marketReview: review, requeued: false };
    }

    if (review.state === "MISMATCH") {
      const previousClaimedAt = item.transmission.claimedAt;
      item.transmission = {
        token: randomUUID(),
        fingerprint: item.plan.fingerprint,
        claimedAt: new Date().toISOString(),
        batchId: nextBatchId,
      };
      item.error_code = null;
      await auditMonthlyPrice(item, "LEGACY_MARKET_PRICE_MISMATCH_REQUEUE", {
        previousClaimedAt,
        mismatchMallKeys: review.mismatchMallKeys,
        mismatches: review.mismatches,
        unresolvedMallKeys: review.unresolvedMallKeys,
        nextBatchId,
      });
      return { ...response(item), marketReview: review, requeued: true };
    }

    await auditMonthlyPrice(item, "LEGACY_MARKET_PRICE_REVIEW_UNCERTAIN", {
      unresolvedMallKeys: review.unresolvedMallKeys,
      matchedMallKeys: review.matchedMallKeys,
      inactiveMallKeys: review.inactiveMallKeys,
    });
    return { ...response(item), marketReview: review, requeued: false };
  });
}
