import { buildDetailHtml } from "../../public/product-launch-tracker-app/lib/detail-page-html.mjs";
import type { AiSaurusHostedReceipt } from "./aiSaurusBulkDetailTypes.ts";
import { AI_SAURUS_REVIEW_ROLES, readSaurusReviewAssets, saurusResultImageUrl } from "./aiSaurusReviewAssets.ts";

export type SaurusLaunchMaterials = {
  detailImageUrl: string;
  mainImageUrl: string;
  additionalImageUrls: string[];
  html: string;
};

const B_CODE = /^B[A-Z]{1,2}\d+-\d+$/;
const TEXT_LIMIT = 4000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bCode(value: unknown) {
  const code = text(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  return B_CODE.test(code) ? code : "";
}

export function saurusProductBCodes(item: Record<string, unknown>) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions : [];
  const optionCodes = options.map((option) => bCode(object(option).barcode)).filter(Boolean);
  if (!optionCodes.length && options.length <= 1) {
    const single = bCode(item.barcode) || bCode(item.warehouseLocation);
    if (single) optionCodes.push(single);
  }
  return [...new Set(optionCodes)].sort();
}

export function saurusLaunchMaterials(item: Record<string, unknown>): SaurusLaunchMaterials {
  const asset = object(item.detailPageAsset);
  return {
    detailImageUrl: text(asset.detailImageUrl),
    mainImageUrl: text(asset.mainImageUrl),
    additionalImageUrls: Array.isArray(asset.additionalImageUrls) ? asset.additionalImageUrls.map(text).filter(Boolean) : [],
    html: text(asset.html),
  };
}

export function sameSaurusLaunchMaterials(left: SaurusLaunchMaterials, right: SaurusLaunchMaterials) {
  return left.detailImageUrl === right.detailImageUrl && left.mainImageUrl === right.mainImageUrl &&
    left.html === right.html && JSON.stringify(left.additionalImageUrls) === JSON.stringify(right.additionalImageUrls);
}

export function saurusApprovedMaterials(receipt: AiSaurusHostedReceipt, name: string): SaurusLaunchMaterials {
  const assets = readSaurusReviewAssets(receipt.reviewAssets, receipt.transferReceiptId);
  const urls = AI_SAURUS_REVIEW_ROLES.map((role) => assets?.[role]);
  if (urls.some((id) => !id) || receipt.hostedImageUrl !== saurusResultImageUrl(receipt.transferReceiptId)) {
    throw new Error("같은 작업에서 호스팅된 대표 이미지 1장, 부가 이미지 4장, 상세페이지가 모두 있어야 승인할 수 있습니다.");
  }
  const [mainImageUrl, ...additionalImageUrls] = urls.map((id) => saurusResultImageUrl(id!));
  return {
    detailImageUrl: receipt.hostedImageUrl, mainImageUrl, additionalImageUrls,
    html: buildDetailHtml(receipt.hostedImageUrl, name),
  };
}

function hostedHttpUrl(value: unknown) {
  const raw = text(value);
  const url = raw.length <= TEXT_LIMIT && /^https?:\/\/\S+$/i.test(raw) ? URL.parse(raw) : null;
  if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("호스팅한 이미지의 HTTP 또는 HTTPS 주소를 확인해 주세요.");
  }
  return url.href;
}

export function saurusManualMaterials(value: unknown, name: string): SaurusLaunchMaterials {
  const input = object(value);
  if (!Array.isArray(input.additionalImageUrls) || input.additionalImageUrls.length > 10) {
    throw new Error("부가 이미지 주소는 최대 10개까지 입력할 수 있습니다.");
  }
  const detailImageUrl = hostedHttpUrl(input.detailImageUrl);
  const mainImageUrl = hostedHttpUrl(input.mainImageUrl);
  const additionalImageUrls = input.additionalImageUrls.map(hostedHttpUrl);
  if (new Set([detailImageUrl, mainImageUrl, ...additionalImageUrls]).size !== additionalImageUrls.length + 2) {
    throw new Error("각 이미지의 주소를 한 번씩 입력해 주세요.");
  }
  return { detailImageUrl, mainImageUrl, additionalImageUrls, html: buildDetailHtml(detailImageUrl, name) };
}
