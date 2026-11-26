import { NextRequest } from "next/server";

import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { withProductLaunchListSnapshot } from "@/lib/productLaunchTrackerListSnapshot";
import { shiftProductLaunchPurchaseLink } from "@/lib/productLaunchTrackerPurchaseLinkHealth";
import {
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MAX_SHIFT_ITEMS = 500;
const WRITE_TIMEOUT_MS = 6_000;

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, max = 4000) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function itemIds(value: unknown) {
  const source = Array.isArray(value) ? value : [value];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of source) {
    const itemId = text(entry, 180);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    output.push(itemId);
    if (output.length >= MAX_SHIFT_ITEMS) break;
  }
  return output;
}

async function conditionalWrite(input: {
  config: ProductLaunchAdminConfig;
  ownerId: string;
  email: string;
  state: UnknownRecord;
  previousUpdatedAt: string;
}) {
  const now = new Date().toISOString();
  const schemaVersion = Math.max(
    3,
    Math.floor(Number(input.state.schemaVersion) || 3),
  );
  const params = new URLSearchParams({
    owner_id: `eq.${input.ownerId}`,
    updated_at: `eq.${input.previousUpdatedAt}`,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${input.config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
      {
        method: "PATCH",
        headers: {
          ...createSupabaseAdminHeaders(input.config.secretKey),
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          owner_email: input.email,
          state_payload: input.state,
          schema_version: schemaVersion,
          updated_at: now,
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    const body = await readResponseJson(response);
    if (!response.ok) {
      throw new Error(readProductLaunchError(body, response.status));
    }
    return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const input = record(await request.json().catch(() => ({})));
  const ids = itemIds(input.itemIds);
  if (!ids.length) {
    return Response.json(
      { ok: false, code: "CHINA_LINK_SHIFT_ITEMS_REQUIRED", message: "발주용 링크를 정리할 상품을 선택하세요." },
      { status: 400 },
    );
  }
  const expectedRaw = record(input.expectedPrimaryUrls);
  const expected = Object.fromEntries(
    ids.map((id) => [id, text(expectedRaw[id], 4000)]),
  ) as Record<string, string>;
  const reason =
    text(input.reason, 300) || "발주용 링크 오류 삭제 후 다음 발주 후보 적용";

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = (await readProductLaunchState(
        config.value,
        identity.value.userId,
      )) as StoredRow | null;
      const state = record(stored?.state_payload);
      const previousUpdatedAt = text(stored?.updated_at, 80);
      if (!previousUpdatedAt || !Array.isArray(state.items)) {
        throw new Error("저장된 상품출시 진행관리 상태를 찾지 못했습니다.");
      }

      const idSet = new Set(ids);
      const found = new Set<string>();
      const now = new Date().toISOString();
      const nextItems = state.items.map((raw) => {
        const item = record(raw);
        const itemId = text(item.id, 180);
        if (!idSet.has(itemId)) return raw;
        found.add(itemId);
        return shiftProductLaunchPurchaseLink(item, expected[itemId], now, reason);
      });
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) {
        throw new Error(`상품 ${missing.length}건을 찾지 못했습니다. 목록을 새로고침해 주세요.`);
      }

      const nextState = withProductLaunchListSnapshot({
        ...state,
        items: nextItems,
        savedAt: now,
        schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
      });
      const saved = await conditionalWrite({
        config: config.value,
        ownerId: identity.value.userId,
        email: identity.value.email,
        state: nextState,
        previousUpdatedAt,
      });
      if (!saved) continue;

      let normalizedSynced = true;
      try {
        const sync = await syncProductLaunchNormalizedChangedItems(
          config.value,
          identity.value,
          nextState,
          text(saved.updated_at, 80) || now,
          ids,
        );
        normalizedSynced = sync.synced === true;
      } catch (error) {
        normalizedSynced = false;
        console.error("China primary link normalized sync failed", error);
      }
      if (!normalizedSynced) {
        await setProductLaunchNormalizedReadEnabled(
          config.value,
          identity.value.userId,
          false,
        ).catch(() => null);
      }

      return Response.json({
        ok: true,
        shiftedCount: ids.length,
        changedIds: ids,
        normalizedSynced,
        updatedAt: text(saved.updated_at, 80) || now,
      });
    }

    return Response.json(
      {
        ok: false,
        code: "CHINA_LINK_SHIFT_CONCURRENT_UPDATE",
        message: "다른 저장과 동시에 변경되었습니다. 목록을 새로고침한 뒤 다시 실행하세요.",
      },
      { status: 409 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "발주용 링크를 정리하지 못했습니다.";
    const status = /변경되었습니다|동시에/.test(message)
      ? 409
      : /선택|없습니다|찾지 못|필요/.test(message)
        ? 400
        : 500;
    return Response.json(
      {
        ok: false,
        code: "CHINA_LINK_SHIFT_FAILED",
        message,
      },
      { status },
    );
  }
}
