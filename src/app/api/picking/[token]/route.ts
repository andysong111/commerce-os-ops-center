import { readPickingShare, updatePickingShareCompletion } from "@/lib/pickingShare";

function noStore(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await readPickingShare(token);
  return result.ok ? noStore({ ok: true, picking: result.value }) : noStore({ ok: false, code: result.code }, result.status);
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  let body: { barcode?: unknown; completed?: unknown };
  try {
    body = await request.json() as { barcode?: unknown; completed?: unknown };
  } catch {
    return noStore({ ok: false, code: "PICKING_REQUEST_INVALID" }, 400);
  }
  if (typeof body.barcode !== "string" || typeof body.completed !== "boolean") {
    return noStore({ ok: false, code: "PICKING_REQUEST_INVALID" }, 400);
  }
  const { token } = await context.params;
  const result = await updatePickingShareCompletion(token, body.barcode.trim().toUpperCase(), body.completed);
  return result.ok ? noStore({ ok: true, completion: result.value }) : noStore({ ok: false, code: result.code }, result.status);
}
