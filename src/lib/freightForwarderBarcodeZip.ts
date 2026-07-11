import { zipSync } from "fflate";
import { calculateBarcodeLabelPrint } from "./barcodeLabelPrint";
import { getEncodedBarcodeValue } from "./barcodeValue";
import { generateFreightForwarderLabelPdf, selectFreightForwarderLabelTemplate, type FreightForwarderLabelTemplate } from "./freightForwarderBarcodePdf";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest";

export interface FreightForwarderZipExclusion { rowNo?: number; reason: string; }
export interface FreightForwarderZipResult { zipBytes: Uint8Array; zipFileName: string; folderName: string; generated: number; total: number; exclusions: FreightForwarderZipExclusion[]; filenames: string[]; }

export function normalizeFreightForwarderFilePart(value: unknown): string {
  return String(value ?? "").replace(/쿠팡\s*1번\s*센터/g, "").replace(/\s+/g, " ").trim();
}

export function buildFreightForwarderPdfFileName(applicationNo: string, rowNo: number, printCount: number): string {
  return normalizeFreightForwarderFilePart(`${applicationNo}-${rowNo}번 ${printCount}개.pdf`);
}

export function isWarehouseLocationLikeBarcode(value: string): boolean {
  return /^(?:[A-Z]{2,4}\d{1,3}-\d{1,3}|[A-Z]\d{1,3}-\d{1,3})$/.test(value.trim());
}

export function sortFreightForwarderRows<T extends { rowNo?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (Number(a.rowNo) || 0) - (Number(b.rowNo) || 0));
}

export function validateFreightForwarderRows(items: FreightApplicationItem[]) {
  const seen = new Set<number>();
  const valid: FreightApplicationItem[] = [];
  const exclusions: FreightForwarderZipExclusion[] = [];
  for (const item of sortFreightForwarderRows(items)) {
    const rowNo = Number(item.rowNo);
    const barcode = getEncodedBarcodeValue(item.barcode);
    const printCount = calculateBarcodeLabelPrint(item).printCount;
    if (!Number.isFinite(rowNo) || rowNo <= 0) exclusions.push({ reason: "순번 없음" });
    else if (seen.has(rowNo)) exclusions.push({ rowNo, reason: "중복 순번" });
    else if (!barcode) exclusions.push({ rowNo, reason: "바코드 값 없음" });
    else if (!Number.isFinite(printCount) || printCount <= 0) exclusions.push({ rowNo, reason: "출력 수량 없음" });
    else {
      seen.add(rowNo);
      valid.push(item);
    }
  }
  return { valid, exclusions };
}

export function formatFreightForwarderZipStatus(total: number, generated: number, exclusions: FreightForwarderZipExclusion[]): string {
  if (exclusions.length === 0) return `총 ${generated}개 PDF 생성 완료`;
  return [`총 ${total}개 품목 중 ${generated}개 PDF 생성 완료`, `${exclusions.length}개 제외:`, ...exclusions.map((e) => `* ${e.rowNo ? `${e.rowNo}번` : "순번 없음"}: ${e.reason}`)].join("\n");
}

export function buildFreightForwarderBarcodeZip(
  application: FreightApplication,
  template: FreightForwarderLabelTemplate = "small",
): FreightForwarderZipResult {
  const applicationNo = normalizeFreightForwarderFilePart(application.applicationNo || "unknown");
  const folderName = applicationNo;
  const { valid, exclusions } = validateFreightForwarderRows(application.items);
  const files: Record<string, Uint8Array> = {};
  const filenames: string[] = [];
  for (const item of valid) {
    const printCount = calculateBarcodeLabelPrint(item).printCount;
    const filename = buildFreightForwarderPdfFileName(applicationNo, item.rowNo, printCount);
    filenames.push(filename);
    const resolvedTemplate = selectFreightForwarderLabelTemplate(item, template);
    files[`${folderName}/${filename}`] = generateFreightForwarderLabelPdf(item, resolvedTemplate);
  }
  return { zipBytes: zipSync(files), zipFileName: `${applicationNo}.zip`, folderName, generated: valid.length, total: application.items.length, exclusions, filenames };
}
