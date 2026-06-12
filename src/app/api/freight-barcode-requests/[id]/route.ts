import {
  deleteFreightBarcodeHistoryRecord,
  getFreightBarcodeHistoryRecord,
  updateFreightBarcodeHistoryRecord,
} from "@/lib/freightBarcodeHistoryStore";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface UpdateRequestBody {
  title?: unknown;
  memo?: unknown;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const record = getFreightBarcodeHistoryRecord(id);
  if (!record) {
    return Response.json({ error: "Freight barcode history record not found." }, { status: 404 });
  }

  return Response.json({ record });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: UpdateRequestBody;
  try {
    body = await request.json() as UpdateRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    (body.title === undefined && body.memo === undefined) ||
    (body.title !== undefined && typeof body.title !== "string") ||
    (body.memo !== undefined && typeof body.memo !== "string")
  ) {
    return Response.json({ error: "Only title or memo can be updated." }, { status: 400 });
  }

  const record = updateFreightBarcodeHistoryRecord(id, {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.memo === "string" ? { memo: body.memo } : {}),
  });
  if (!record) {
    return Response.json({ error: "Freight barcode history record not found." }, { status: 404 });
  }

  return Response.json({ record });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!deleteFreightBarcodeHistoryRecord(id)) {
    return Response.json({ error: "Freight barcode history record not found." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
