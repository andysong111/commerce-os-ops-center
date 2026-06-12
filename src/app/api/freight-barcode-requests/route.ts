import { getFreightBarcodeHistoryStorage } from "@/lib/freightBarcodeHistoryStorage";
import type { FreightApplicationItem } from "@/types/freightBarcodeRequest";

interface CreateRequestBody {
  applicationNo?: unknown;
  title?: unknown;
  rawText?: unknown;
  parsedItems?: unknown;
  memo?: unknown;
  source?: unknown;
}

function isFreightApplicationItem(value: unknown): value is FreightApplicationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FreightApplicationItem>;
  return (
    typeof item.id === "string" &&
    typeof item.rowNo === "number" &&
    typeof item.itemName === "string" &&
    typeof item.optionText === "string" &&
    typeof item.quantity === "number"
  );
}

export async function GET() {
  const storage = getFreightBarcodeHistoryStorage();
  return Response.json({ records: await storage.list() });
}

export async function POST(request: Request) {
  let body: CreateRequestBody;
  try {
    body = await request.json() as CreateRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.applicationNo !== "string" ||
    typeof body.rawText !== "string" ||
    !Array.isArray(body.parsedItems) ||
    !body.parsedItems.every(isFreightApplicationItem) ||
    (body.title !== undefined && typeof body.title !== "string") ||
    (body.memo !== undefined && typeof body.memo !== "string") ||
    (body.source !== undefined &&
      body.source !== "manual-paste" &&
      body.source !== "restored-history")
  ) {
    return Response.json({ error: "Invalid freight barcode history request." }, { status: 400 });
  }

  const storage = getFreightBarcodeHistoryStorage();
  const record = await storage.create({
    applicationNo: body.applicationNo,
    rawText: body.rawText,
    items: body.parsedItems,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.memo !== undefined ? { memo: body.memo } : {}),
    ...(body.source !== undefined ? { source: body.source } : {}),
  });

  return Response.json({ record }, { status: 201 });
}
