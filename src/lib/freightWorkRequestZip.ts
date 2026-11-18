import { zipSync } from "fflate";
import { calculateBarcodeLabelPrint } from "./barcodeLabelPrint.ts";
import { getEncodedBarcodeValue } from "./barcodeValue.ts";
import { createCode128Layout } from "./code128.ts";
import { getFreightApplicationNumbers } from "./freightApplicationBatch.ts";
import { buildFreightImageSourceChain } from "./freightImageProxy.ts";
import { getFreightItemImageSources } from "./richPasteExtractor.ts";
import type {
  FreightApplication,
  FreightApplicationItem,
} from "../types/freightBarcodeRequest.ts";

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 1754;
const PDF_WIDTH_PT = 595.28;
const PDF_HEIGHT_PT = 841.89;
const ITEMS_PER_PAGE = 5;
const CARD_HEIGHT = 280;
const CARD_GAP = 12;
const CARD_START_Y = 240;
const FONT_FAMILY =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", Arial, sans-serif';

export interface FreightWorkRequestGroup {
  applicationNo: string;
  items: FreightApplicationItem[];
}

export interface FreightWorkRequestZipResult {
  applicationNos: string[];
  pdfCount: number;
  zipFilename: string;
  zipBytes: Uint8Array;
  statusMessage: string;
}

export interface JpegPdfPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type FreightWorkRequestPdfRenderer = (
  group: FreightWorkRequestGroup,
  createdDate: string,
) => Promise<Uint8Array>;

export function groupFreightWorkRequestItems(
  application: FreightApplication,
): FreightWorkRequestGroup[] {
  const declaredApplicationNos = getFreightApplicationNumbers(application);
  const fallbackApplicationNo =
    declaredApplicationNos.length === 1
      ? declaredApplicationNos[0]
      : application.applicationNo.trim() || "unknown";
  const groupedItems = new Map<string, FreightApplicationItem[]>();

  for (const applicationNo of declaredApplicationNos) {
    groupedItems.set(applicationNo, []);
  }
  for (const item of application.items) {
    const applicationNo = item.applicationNo?.trim() || fallbackApplicationNo;
    const rows = groupedItems.get(applicationNo) ?? [];
    rows.push(item);
    groupedItems.set(applicationNo, rows);
  }
  if (groupedItems.size === 0) groupedItems.set(fallbackApplicationNo, []);

  return [...groupedItems].map(([applicationNo, items]) => ({
    applicationNo,
    items: [...items].sort((left, right) => left.rowNo - right.rowNo),
  }));
}

export async function buildFreightWorkRequestZip(
  application: FreightApplication,
  createdDate: string,
  renderPdf: FreightWorkRequestPdfRenderer = renderFreightWorkRequestPdf,
): Promise<FreightWorkRequestZipResult> {
  const groups = groupFreightWorkRequestItems(application);
  const files: Record<string, Uint8Array> = {};

  for (const group of groups) {
    files[`${group.applicationNo}/`] = new Uint8Array();
    files[
      `${group.applicationNo}/작업요청서-${group.applicationNo}.pdf`
    ] = await renderPdf(group, createdDate);
  }

  const applicationNos = groups.map((group) => group.applicationNo);
  return {
    applicationNos,
    pdfCount: groups.length,
    zipFilename: `작업요청서-${applicationNos.join("_")}.zip`,
    zipBytes: zipSync(files, { level: 0 }),
    statusMessage: `신청서 ${groups.length}건의 작업요청서 PDF를 신청번호별 폴더에 생성했습니다.`,
  };
}

export function buildJpegPagesPdf(pages: JpegPdfPage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error("At least one JPEG page is required.");
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;

  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (objectNumber: number) => {
    offsets[objectNumber] = length;
    append(`${objectNumber} 0 obj\n`);
  };

  append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  startObject(1);
  append("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  startObject(2);
  append(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`,
  );

  pages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const content = `q\n${PDF_WIDTH_PT} 0 0 ${PDF_HEIGHT_PT} 0 0 cm\n/Im1 Do\nQ\n`;
    const contentBytes = encoder.encode(content);

    startObject(pageObject);
    append(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH_PT} ${PDF_HEIGHT_PT}] /Resources << /XObject << /Im1 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );

    startObject(imageObject);
    append(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
    );
    append(page.bytes);
    append("\nendstream\nendobj\n");

    startObject(contentObject);
    append(`<< /Length ${contentBytes.length} >>\nstream\n`);
    append(contentBytes);
    append("endstream\nendobj\n");
  });

  const xrefOffset = length;
  const objectCount = 2 + pages.length * 3;
  append(`xref\n0 ${objectCount + 1}\n`);
  append("0000000000 65535 f \n");
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    append(
      `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`,
    );
  }
  append(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function renderFreightWorkRequestPdf(
  group: FreightWorkRequestGroup,
  createdDate: string,
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("Work-request PDF rendering requires a browser.");
  }

  const pageItems =
    group.items.length === 0
      ? [[]]
      : Array.from(
          { length: Math.ceil(group.items.length / ITEMS_PER_PAGE) },
          (_, index) =>
            group.items.slice(
              index * ITEMS_PER_PAGE,
              (index + 1) * ITEMS_PER_PAGE,
            ),
        );
  const imageCache = new Map<string, Promise<ImageBitmap | undefined>>();
  const loadedImages = new Set<ImageBitmap>();
  const pages: JpegPdfPage[] = [];

  try {
    for (let pageIndex = 0; pageIndex < pageItems.length; pageIndex += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context is unavailable.");

      const items = pageItems[pageIndex];
      const images = await Promise.all(
        items.map((item) => loadFirstItemImage(item, imageCache)),
      );
      for (const image of images) if (image) loadedImages.add(image);
      drawWorkRequestPage(
        context,
        group.applicationNo,
        createdDate,
        pageIndex + 1,
        pageItems.length,
        items,
        images,
      );

      pages.push({
        bytes: await canvasToJpegBytes(canvas),
        width: canvas.width,
        height: canvas.height,
      });
    }
    return buildJpegPagesPdf(pages);
  } finally {
    for (const image of loadedImages) image.close();
  }
}

function drawWorkRequestPage(
  context: CanvasRenderingContext2D,
  applicationNo: string,
  createdDate: string,
  pageNumber: number,
  pageCount: number,
  items: FreightApplicationItem[],
  images: Array<ImageBitmap | undefined>,
) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.textBaseline = "top";

  setCanvasFont(context, 36, 700);
  context.fillStyle = "#0f172a";
  drawCenteredText(context, "바코드 작업요청서", CANVAS_WIDTH / 2, 38);
  context.strokeStyle = "#0f172a";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(54, 94);
  context.lineTo(CANVAS_WIDTH - 54, 94);
  context.stroke();

  setCanvasFont(context, 18, 700);
  context.fillText(`신청번호: ${applicationNo}`, 60, 116);
  context.textAlign = "right";
  context.fillText(
    `생성일자: ${createdDate} · ${pageNumber}/${pageCount}`,
    CANVAS_WIDTH - 60,
    116,
  );
  context.textAlign = "left";

  setCanvasFont(context, 16, 400);
  context.fillStyle = "#334155";
  context.fillText(
    "바코드 라벨에 MADE IN CHINA가 포함되어 원산지 스티커는 별도로 부착하지 않습니다.",
    60,
    154,
  );
  context.fillText(
    "같은 상품도 옵션별 바코드가 다를 수 있으니 상품 카드별로 구분해 작업해주세요.",
    60,
    181,
  );
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(54, 218);
  context.lineTo(CANVAS_WIDTH - 54, 218);
  context.stroke();

  if (items.length === 0) {
    setCanvasFont(context, 24, 600);
    context.fillStyle = "#64748b";
    drawCenteredText(context, "분석된 품목이 없습니다.", CANVAS_WIDTH / 2, 500);
    return;
  }

  items.forEach((item, index) => {
    drawWorkRequestItemCard(
      context,
      item,
      images[index],
      CARD_START_Y + index * (CARD_HEIGHT + CARD_GAP),
    );
  });
}

function drawWorkRequestItemCard(
  context: CanvasRenderingContext2D,
  item: FreightApplicationItem,
  image: ImageBitmap | undefined,
  y: number,
) {
  const x = 54;
  const width = CANVAS_WIDTH - 108;
  context.strokeStyle = "#0f172a";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, CARD_HEIGHT);

  context.strokeStyle = "#94a3b8";
  context.strokeRect(x + 16, y + 18, 54, 54);
  setCanvasFont(context, 22, 700);
  context.fillStyle = "#0f172a";
  drawCenteredText(context, String(item.rowNo), x + 43, y + 33);

  const imageX = x + 88;
  const imageY = y + 18;
  const imageSize = 108;
  context.strokeStyle = "#cbd5e1";
  context.strokeRect(imageX, imageY, imageSize, imageSize);
  if (image) {
    drawContainedImage(context, image, imageX, imageY, imageSize, imageSize);
  } else {
    setCanvasFont(context, 14, 600);
    context.fillStyle = "#94a3b8";
    drawCenteredText(context, "이미지 없음", imageX + imageSize / 2, imageY + 43);
  }

  const detailX = x + 220;
  setCanvasFont(context, 18, 700);
  context.fillStyle = "#0f172a";
  drawFittedLine(
    context,
    `품목: ${item.matchedProductNameKo || item.itemName || "-"}`,
    detailX,
    y + 14,
    840,
  );

  setCanvasFont(context, 16, 400);
  drawWrappedText(
    context,
    `옵션: ${item.optionText || "-"}`,
    detailX,
    y + 43,
    840,
    22,
    2,
  );
  drawFittedLine(
    context,
    `제품 수량: ${item.quantity}    HS CODE: ${item.hsCode || "-"}`,
    detailX,
    y + 94,
    840,
  );
  drawFittedLine(
    context,
    `트래킹번호: ${item.trackingNo || "-"}`,
    detailX,
    y + 119,
    840,
  );
  drawFittedLine(
    context,
    `오픈마켓 주문번호: ${item.orderNo || "-"}`,
    detailX,
    y + 144,
    840,
  );

  context.strokeStyle = "#94a3b8";
  context.beginPath();
  context.moveTo(x + 16, y + 176);
  context.lineTo(x + width - 16, y + 176);
  context.stroke();

  const calculation = calculateBarcodeLabelPrint({
    quantity: item.quantity,
    memo: item.memo,
    bundleUnit: item.bundleUnit,
    printCount: item.labelPrintCount,
  });
  setCanvasFont(context, 16, 700);
  context.fillStyle = "#0f172a";
  context.fillText(
    `바코드: ${item.barcode?.trim() || "바코드 미입력"}`,
    x + 18,
    y + 190,
  );
  setCanvasFont(context, 15, 400);
  context.fillText(
    `소분단위: ${item.bundleUnit ?? "개별"}    바코드 출력수량: ${calculation.printCount}장`,
    x + 18,
    y + 219,
  );
  if (item.memo?.trim()) {
    drawFittedLine(
      context,
      `작업메모: ${item.memo.trim()}`,
      x + 18,
      y + 247,
      650,
    );
  }
  drawBarcode(
    context,
    item.barcode,
    x + 720,
    y + 190,
    width - 748,
    42,
  );
}

function drawBarcode(
  context: CanvasRenderingContext2D,
  value: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const encodedValue = getEncodedBarcodeValue(value);
  if (!encodedValue) {
    setCanvasFont(context, 16, 700);
    context.fillStyle = "#b91c1c";
    drawCenteredText(context, "바코드 미입력", x + width / 2, y + 18);
    return;
  }

  const layout = createCode128Layout(encodedValue);
  const scale = width / layout.width;
  context.fillStyle = "#000000";
  for (const bar of layout.bars) {
    context.fillRect(x + bar.x * scale, y, Math.max(1, bar.width * scale), height);
  }
  setCanvasFont(context, 13, 700);
  drawCenteredText(context, encodedValue, x + width / 2, y + height + 5);
}

function setCanvasFont(
  context: CanvasRenderingContext2D,
  size: number,
  weight: number,
) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  value: string,
  centerX: number,
  y: number,
) {
  const previousAlignment = context.textAlign;
  context.textAlign = "center";
  context.fillText(value, centerX, y);
  context.textAlign = previousAlignment;
}

function drawFittedLine(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  const [line] = wrapText(context, value, maxWidth, 1);
  context.fillText(line, x, y);
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  wrapText(context, value, maxWidth, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const characters = [...String(value ?? "")];
  const lines: string[] = [];
  let line = "";
  let truncated = false;

  for (const character of characters) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines) {
        truncated = true;
        break;
      }
    } else {
      line = candidate;
    }
  }
  if (!truncated && line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) lines.push("");

  if (truncated) {
    let last = lines[maxLines - 1] ?? "";
    while (
      last &&
      context.measureText(`${last}…`).width > maxWidth
    ) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

async function loadFirstItemImage(
  item: FreightApplicationItem,
  cache: Map<string, Promise<ImageBitmap | undefined>>,
): Promise<ImageBitmap | undefined> {
  for (const source of getFreightItemImageSources(item)) {
    for (const candidate of buildFreightImageSourceChain(source)) {
      let promise = cache.get(candidate);
      if (!promise) {
        promise = fetchImageBitmap(candidate);
        cache.set(candidate, promise);
      }
      const image = await promise;
      if (image) return image;
    }
  }
  return undefined;
}

async function fetchImageBitmap(url: string): Promise<ImageBitmap | undefined> {
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    return await createImageBitmap(await response.blob());
  } catch {
    return undefined;
  }
}

async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("JPEG rendering failed.")),
      "image/jpeg",
      0.86,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}
