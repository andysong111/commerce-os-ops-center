import {
  chinaLinkUsagePatch,
  readChinaDetailPageLink,
  readChinaLinkUsage,
  readChinaPurchaseLink,
} from "../../public/product-launch-tracker-app/lib/china-product-links.mjs";

export function shiftProductLaunchPurchaseLink(
  item: Record<string, unknown>,
  expectedPrimaryUrl: string,
  now: string,
  reason: string,
) {
  const currentPrimary = readChinaPurchaseLink(item);
  const label = String(item.modelNumber || item.id || "").slice(0, 180);
  if (!currentPrimary) throw new Error(`${label}: 삭제할 발주용 링크가 없습니다.`);
  if (!expectedPrimaryUrl) throw new Error(`${label}: 검사한 발주용 링크 주소가 필요합니다.`);
  if (currentPrimary !== expectedPrimaryUrl) {
    throw new Error(`${label}: 검사 이후 발주용 링크가 변경되었습니다. 목록을 새로고침해 주세요.`);
  }

  const current = readChinaLinkUsage(item);
  const [purchaseUrl = "", ...purchaseAlternates] = current.purchaseAlternates;
  const detailPageUrl = readChinaDetailPageLink(item);
  const usagePatch = chinaLinkUsagePatch(item, {
    commonUrl: current.commonUrl === currentPrimary || (!purchaseUrl && !detailPageUrl)
      ? ""
      : current.commonUrl,
    purchaseUrl,
    detailPageUrl,
    purchaseAlternates,
  });
  return {
    ...item,
    ...usagePatch,
    chinaLinkMaintenance: {
      ...(typeof item.chinaLinkMaintenance === "object" && item.chinaLinkMaintenance !== null
        ? item.chinaLinkMaintenance
        : {}),
      lastRemovedPrimaryUrl: currentPrimary,
      lastPromotedPrimaryUrl: purchaseUrl,
      shiftedAt: now,
      reason,
    },
    updatedAt: now,
    updatedBy: "승준",
  };
}
