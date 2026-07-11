import { strToU8, zipSync } from "fflate";
import { buildFreightForwarderBarcodeLabelData, createFreightForwarderBarcodePdf, type FreightForwarderBarcodeTemplateId } from "./freightForwarderBarcodePdf.ts";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export interface FreightForwarderBarcodeZipEntry {
  item: FreightApplicationItem;
  path: string;
  pdf: Uint8Array<ArrayBuffer>;
}

export interface FreightForwarderBarcodeZipResult {
  zipFilename: string;
  folderName: string;
  entries: FreightForwarderBarcodeZipEntry[];
  excluded: { rowNo: number; reason: "missing-barcode" | "duplicate-row-no" }[];
  bytes: Uint8Array;
}

export function createFreightForwarderBarcodeZip(
  application: FreightApplication,
  options: { templateId?: FreightForwarderBarcodeTemplateId } = {},
): FreightForwarderBarcodeZipResult {
  const folderName = sanitizePathSegment(application.applicationNo || "unknown");
  const sortedItems = [...application.items].sort((a, b) => a.rowNo - b.rowNo);
  const seenRowNos = new Set<number>();
  const entries: FreightForwarderBarcodeZipEntry[] = [];
  const excluded: FreightForwarderBarcodeZipResult["excluded"] = [];

  for (const item of sortedItems) {
    if (seenRowNos.has(item.rowNo)) {
      excluded.push({ rowNo: item.rowNo, reason: "duplicate-row-no" });
      continue;
    }
    seenRowNos.add(item.rowNo);

    const label = buildFreightForwarderBarcodeLabelData(item, options);
    if (!label) {
      excluded.push({ rowNo: item.rowNo, reason: "missing-barcode" });
      continue;
    }

    const printCount = normalizePrintCount(item.labelPrintCount);
    const filename = `${folderName}-${item.rowNo}번 ${printCount}개.pdf`;
    const path = `${folderName}/${filename}`;
    entries.push({ item, path, pdf: createFreightForwarderBarcodePdf(label, options) });
  }

  const zipEntries = Object.fromEntries(entries.map((entry) => [entry.path, entry.pdf]));
  if (entries.length === 0) zipEntries[`${folderName}/`] = strToU8("");

  return {
    zipFilename: `${folderName}.zip`,
    folderName,
    entries,
    excluded,
    bytes: zipSync(zipEntries, { level: 0 }),
  };
}

function normalizePrintCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.ceil(numeric) : 1;
}

function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-") || "unknown";
}
