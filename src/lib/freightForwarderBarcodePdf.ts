import { createCode128Layout } from "./code128";
import { getEncodedBarcodeValue } from "./barcodeValue";
import type { FreightApplicationItem } from "../types/freightBarcodeRequest";

export type FreightForwarderLabelTemplate = "auto" | "small" | "large";
export type ResolvedFreightForwarderLabelTemplate = "small" | "large";

export const SMALL_FREIGHT_FORWARDER_LABEL_SIZE = { width: 90, height: 147 } as const;
export const LARGE_FREIGHT_FORWARDER_LABEL_SIZE = { width: 425.25, height: 255 } as const;

export interface FreightForwarderLabelData {
  rowNo: number;
  barcode: string;
  itemName?: string;
  optionText?: string;
  importerOrSeller?: string;
  manufacturer?: string;
  origin?: string;
  material?: string;
  usageStandard?: string;
  caution?: string;
  madeInChina: boolean;
}

export function selectFreightForwarderLabelTemplate(
  item: Pick<FreightApplicationItem, "itemName" | "optionText" | "labelTemplate">,
  bulkTemplate: FreightForwarderLabelTemplate = "small",
): ResolvedFreightForwarderLabelTemplate {
  const override = item.labelTemplate ?? "auto";
  if (override === "small" || override === "large") return override;
  if (bulkTemplate === "small" || bulkTemplate === "large") return bulkTemplate;

  const text = `${item.itemName ?? ""} ${item.optionText ?? ""}`.toLowerCase();
  return /스펀지\s*테이프|테이프|tape|sponge\s*tape/.test(text) ? "large" : "small";
}

export function mapFreightForwarderLabelData(item: FreightApplicationItem): FreightForwarderLabelData {
  const origin = item.matchedOriginLabel || item.origin;
  return {
    rowNo: item.rowNo,
    barcode: getEncodedBarcodeValue(item.barcode) ?? "",
    itemName: item.matchedProductNameKo || item.displayName || item.itemName,
    optionText: item.optionName || item.optionText,
    origin,
    madeInChina: /china|중국|made in china/i.test(origin ?? "") || !origin,
  };
}

function pdfText(value: string): string {
  return `(${value.replace(/[\\()]/g, "\\$&").replace(/[\r\n]+/g, " ").slice(0, 110)})`;
}

function addText(commands: string[], text: string | undefined, x: number, y: number, size = 7) {
  const clean = text?.trim();
  if (!clean) return;
  commands.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(clean)} Tj ET`);
}

function addWrappedText(commands: string[], label: string, value: string | undefined, x: number, y: number, maxChars: number, size = 7) {
  const clean = value?.trim();
  if (!clean) return y;
  const line = `${label}: ${clean}`;
  for (let index = 0; index < line.length; index += maxChars) {
    addText(commands, line.slice(index, index + maxChars), x, y, size);
    y -= size + 2;
  }
  return y;
}

function addBarcode(commands: string[], value: string, x: number, y: number, width: number, height: number) {
  const layout = createCode128Layout(value);
  const scale = width / layout.width;
  commands.push("0 0 0 rg");
  for (const bar of layout.bars) {
    commands.push(`${(x + bar.x * scale).toFixed(2)} ${y.toFixed(2)} ${(bar.width * scale).toFixed(2)} ${height.toFixed(2)} re f`);
  }
}

function buildPdf(width: number, height: number, commands: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

export function generateSmallFreightForwarderLabelPdf(data: FreightForwarderLabelData): Uint8Array {
  const commands = ["1 1 1 rg 0 0 90 147 re f", "q 0 1 -1 0 90 18 cm"];
  addBarcode(commands, data.barcode, 4, 54, 78, 28);
  addText(commands, data.barcode, 12, 44, 8);
  let y = 34;
  y = addWrappedText(commands, "PRODUCT", data.itemName, 4, y, 22, 5.2);
  y = addWrappedText(commands, "SPEC", data.optionText, 4, y, 24, 5.2);
  y = addWrappedText(commands, "ORIGIN", data.origin || (data.madeInChina ? "MADE IN CHINA" : undefined), 4, y, 24, 5.2);
  addText(commands, "MADE IN CHINA", 7, Math.max(3, y - 2), 7);
  commands.push("Q");
  return buildPdf(SMALL_FREIGHT_FORWARDER_LABEL_SIZE.width, SMALL_FREIGHT_FORWARDER_LABEL_SIZE.height, commands);
}

export function generateLargeFreightForwarderLabelPdf(data: FreightForwarderLabelData): Uint8Array {
  const { width, height } = LARGE_FREIGHT_FORWARDER_LABEL_SIZE;
  const commands = [`1 1 1 rg 0 0 ${width} ${height} re f`];
  addBarcode(commands, data.barcode, 54, 182, 318, 44);
  addText(commands, data.barcode, 160, 168, 12);
  let y = 146;
  y = addWrappedText(commands, "PRODUCT", data.itemName, 28, y, 72, 9);
  y = addWrappedText(commands, "SPEC", data.optionText, 28, y, 78, 9);
  addWrappedText(commands, "ORIGIN", data.origin || (data.madeInChina ? "MADE IN CHINA" : undefined), 28, y, 78, 9);
  addText(commands, "MADE IN CHINA", 166, 28, 14);
  commands.push("0 0.55 0.25 RG 0.7 w 24 18 m 401 18 l S");
  return buildPdf(width, height, commands);
}

export function generateFreightForwarderLabelPdf(
  item: FreightApplicationItem,
  template: FreightForwarderLabelTemplate = "small",
): Uint8Array {
  const data = mapFreightForwarderLabelData(item);
  const resolvedTemplate = selectFreightForwarderLabelTemplate(item, template);
  return resolvedTemplate === "large"
    ? generateLargeFreightForwarderLabelPdf(data)
    : generateSmallFreightForwarderLabelPdf(data);
}
