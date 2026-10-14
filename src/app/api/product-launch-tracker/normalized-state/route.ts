import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import { GET as legacyGet, PUT as legacyPut } from "../state/route";

export const maxDuration = 90;

type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};

export async function GET(request: NextRequest) {
  return legacyGet(request);
}

export async function PUT(request: NextRequest) {
  const response = await legacyPut(request);
  if (!response.ok) return response;

  try {
    const identity = await resolveProductLaunchIdentity(request);
    if (!identity.ok) return response;
    const config = getProductLaunchAdminConfig();
    if (!config.ok) return response;

    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) return response;

    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      row.state_payload as ProductLaunchTrackerState,
      row.updated_at,
    );
  } catch (error) {
    console.error(
      "[product-launch-normalized-state] legacy write kept; normalized read disabled",
      error,
    );
    await disableNormalizedRead(request);
  }

  return response;
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_STATE_NOT_FOUND",
          message: "다시 계산할 상품출시 진행관리 원본을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const result = await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      row.state_payload as ProductLaunchTrackerState,
      row.updated_at,
      {
        readEnabled: true,
        backfilledAt: new Date().toISOString(),
      },
    );
    return Response.json({
      ok: true,
      ...result,
      sourceUpdatedAt: row.updated_at ?? null,
    });
  } catch (error) {
    console.error(
      "[product-launch-normalized-state] normalized projection rebuild failed",
      error,
    );
    await disableNormalizedRead(request);
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_NORMALIZED_REBUILD_FAILED",
        message: "상품 목록 다시 계산에 실패했습니다. 원본 데이터는 변경되지 않았습니다.",
      },
      { status: 500 },
    );
  }
}

async function disableNormalizedRead(request: NextRequest) {
  try {
    const identity = await resolveProductLaunchIdentity(request);
    if (!identity.ok) return;
    const config = getProductLaunchAdminConfig();
    if (!config.ok) return;
    await setProductLaunchNormalizedReadEnabled(
      config.value,
      identity.value.userId,
      false,
    );
  } catch {
    // The legacy JSON state remains authoritative.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
