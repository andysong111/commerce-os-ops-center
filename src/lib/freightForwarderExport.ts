import { strToU8, zipSync } from "fflate";
import type { FreightApplication, FreightApplicationItem } from "@/types/freightBarcodeRequest";
import { formatBarcodeBundleUnit, calculateBarcodeLabelPrint } from "@/lib/barcodeLabelPrint";

export interface FreightForwarderZipExportFile {
  path: string;
  content: string;
}

export interface FreightForwarderZipExportResult {
  filename: string;
  bytes: Uint8Array;
  files: FreightForwarderZipExportFile[];
}

const FORWARDER_MESSAGE = `바코드 라벨 상단에는 MADE IN CHINA 문구가 포함되어 있으므로 원산지 스티커는 별도로 부착하지 않으셔도 됩니다.\n같은 상품이라도 옵션별로 바코드번호가 다를 수 있으니 상품 카드별로 구분해서 작업 부탁드립니다.`;

function safeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9가-힣._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itemDisplayName(item: FreightApplicationItem): string {
  return item.matchedProductNameKo || item.matchedModelName || item.itemName || `품목 ${item.rowNo}`;
}

function buildWorkRequestHtml(application: FreightApplication, createdDate: string): string {
  const rows = application.items.map((item) => {
    const calculation = calculateBarcodeLabelPrint({
      quantity: item.quantity,
      memo: item.memo,
      bundleUnit: item.bundleUnit,
      printCount: item.labelPrintCount,
    });

    return `<tr>
      <td>${escapeHtml(item.rowNo)}</td>
      <td>${escapeHtml(itemDisplayName(item))}<br><small>${escapeHtml(item.optionText)}</small></td>
      <td>${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.hsCode || "-")}</td>
      <td>${escapeHtml(item.trackingNo || "-")}</td>
      <td>${escapeHtml(item.orderNo || "-")}</td>
      <td><strong>${escapeHtml(item.barcode || "바코드 미입력")}</strong></td>
      <td>${escapeHtml(formatBarcodeBundleUnit(item))}</td>
      <td>${escapeHtml(`${calculation.printCount}장`)}</td>
      <td>${escapeHtml(item.memo || "-")}</td>
    </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>barcode-work-request-${escapeHtml(application.applicationNo || "unknown")}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #0f172a; }
  h1 { text-align: center; border-bottom: 2px solid #111827; padding-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #94a3b8; padding: 6px; vertical-align: top; }
  th { background: #e2e8f0; }
  small { color: #475569; }
  .message { border: 1px solid #94a3b8; padding: 10px; margin: 14px 0; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>바코드 작업요청서</h1>
<p><strong>신청번호:</strong> ${escapeHtml(application.applicationNo || "-")} &nbsp; <strong>생성일자:</strong> ${escapeHtml(createdDate)}</p>
<div class="message">${escapeHtml(FORWARDER_MESSAGE)}</div>
<table>
<thead><tr><th>순번</th><th>품목/옵션</th><th>수량</th><th>HS CODE</th><th>트래킹번호</th><th>오픈마켓 주문번호</th><th>바코드</th><th>소분단위</th><th>출력수량</th><th>작업메모</th></tr></thead>
<tbody>${rows || `<tr><td colspan="10">분석된 품목이 없습니다.</td></tr>`}</tbody>
</table>
</body>
</html>`;
}

function buildSummaryJson(application: FreightApplication, createdDate: string): string {
  return JSON.stringify({
    applicationNo: application.applicationNo,
    createdDate,
    itemCount: application.items.length,
    barcodeItemCount: application.items.filter((item) => item.barcode?.trim()).length,
    items: application.items.map((item) => ({
      rowNo: item.rowNo,
      itemName: itemDisplayName(item),
      optionText: item.optionText,
      quantity: item.quantity,
      hsCode: item.hsCode,
      trackingNo: item.trackingNo,
      orderNo: item.orderNo,
      barcode: item.barcode,
      bundleUnit: formatBarcodeBundleUnit(item),
      labelPrintCount: calculateBarcodeLabelPrint({ quantity: item.quantity, memo: item.memo, bundleUnit: item.bundleUnit, printCount: item.labelPrintCount }).printCount,
      memo: item.memo,
    })),
  }, null, 2);
}

export function buildFreightForwarderZipExport(application: FreightApplication, createdDate: string): FreightForwarderZipExportResult {
  const baseName = `freight-forwarder-${safeSegment(application.applicationNo)}-${safeSegment(createdDate)}`;
  const files: FreightForwarderZipExportFile[] = [
    { path: `${baseName}/barcode-work-request.html`, content: buildWorkRequestHtml(application, createdDate) },
    { path: `${baseName}/forwarder-message.txt`, content: FORWARDER_MESSAGE },
    { path: `${baseName}/summary.json`, content: buildSummaryJson(application, createdDate) },
  ];
  const entries = Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)]));
  return { filename: `${baseName}.zip`, bytes: zipSync(entries), files };
}
