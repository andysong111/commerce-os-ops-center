import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import {
  isUsableStockSheetChinaOption,
  prepareStockSheetChinaOptionRefresh,
  type StockSheetChinaOptionRow,
} from "@/lib/stockSheetChinaOptionRefresh";

export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "stockSheetChinaOptionRefresh20261017V4";
const MIGRATION_VERSION = "2026-10-17-stock-sheet-china-option-refresh-v4";
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/13hSSgEX5SHjoshdg89GaBdOwy4xSQjvvZB7gI_IuZ4o/export?format=csv&gid=428248334";

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, {
    requireSameOrigin: false,
  });
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
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시진행관리 서버 저장본을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const currentState = row.state_payload as ProductLaunchTrackerState;
    const marker = asRecord(asRecord(currentState.serverMigrations)[MIGRATION_KEY]);
    if (text(marker.status) === "applied") {
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: text(marker.appliedAt),
        report: marker.report ?? null,
      });
    }

    const source = await readStockSheetRows();
    const prepared = prepareStockSheetChinaOptionRefresh(
      currentState,
      source.rows,
      MIGRATION_VERSION,
    );
    const apply = request.nextUrl.searchParams.get("apply") === "1";

    if (!apply) {
      return Response.json({ ok: true, dryRun: true, report: prepared.report });
    }

    if (!prepared.report.usableSourceRowCount || !prepared.report.matchedModelItems) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_CHINA_OPTION_SOURCE_EMPTY",
          message: "시트의 중국옵션명 또는 상품출시진행관리 매칭 결과가 비어 있어 적용을 중단했습니다.",
          report: prepared.report,
        },
        { status: 409 },
      );
    }

    const appliedAt = new Date().toISOString();
    const nextState: ProductLaunchTrackerState = {
      ...prepared.state,
      savedAt: appliedAt,
      serverMigrations: {
        ...asRecord(prepared.state.serverMigrations),
        [MIGRATION_KEY]: {
          status: "applied",
          version: MIGRATION_VERSION,
          appliedAt,
          source: "실재고 상품 관리표/실재고 사전 B,C,E,F",
          policy: "기존 상세 중국옵션은 보존하고 빈 값·미정·단품 placeholder만 모델번호·상품명·판매옵션 기준으로 채움",
          report: prepared.report,
        },
      },
    };

    const saved = await conditionalWriteState(
      config.value,
      identity.value,
      nextState,
      nullableText(row.updated_at),
    );
    if (!saved) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_CHINA_OPTION_CONCURRENT_UPDATE",
          message: "적용 중 다른 저장이 발생했습니다. 다시 실행하세요.",
        },
        { status: 409 },
      );
    }

    const changed = new Set(prepared.changedItemIds);
    const affectedItems = Array.isArray(prepared.state.items)
      ? prepared.state.items.filter(
          (item) => isRecord(item) && changed.has(text(item.id)),
        )
      : [];
    const [normalized, productMaster] = await Promise.allSettled([
      reconcileProductLaunchNormalizedAfterLegacyItems(
        config.value,
        identity.value,
        prepared.changedItemIds,
      ),
      pushCanonicalProductMasterSnapshotFromTrackerState({
        schemaVersion: 3,
        savedAt: appliedAt,
        items: affectedItems,
      }),
    ]);

    return Response.json({
      ok: true,
      applied: true,
      appliedAt,
      report: prepared.report,
      normalizedSynced: normalized.status === "fulfilled",
      normalizedError:
        normalized.status === "rejected" ? String(normalized.reason) : null,
      productMasterSynced: productMaster.status === "fulfilled",
      productMasterError:
        productMaster.status === "rejected" ? String(productMaster.reason) : null,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_CHINA_OPTION_REFRESH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실재고표 중국옵션명 반영을 완료하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

async function readStockSheetRows() {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`실재고 상품 관리표 CSV를 불러오지 못했습니다. status=${response.status}`);
  }
  const input = await response.text();
  if (/<!doctype html|<html/i.test(input.slice(0, 500))) {
    throw new Error("실재고 상품 관리표 CSV 대신 HTML 응답을 받았습니다.");
  }

  const table = parseCsv(input);
  const rows: StockSheetChinaOptionRow[] = [];
  for (let index = 4; index < table.length; index += 1) {
    const source = table[index] ?? [];
    const modelNumber = normalizeModel(source[1]);
    const chinaOption = text(source[5]);
    if (!modelNumber || !isUsableStockSheetChinaOption(chinaOption)) continue;
    rows.push({
      rowNumber: index + 1,
      modelNumber,
      productName: text(source[2]),
      saleOption: text(source[4]),
      chinaOption,
    });
  }
  return { table, rows };
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) {
    return (await writeProductLaunchState(
      config,
      identity,
      state as Record<string, unknown>,
    )) as StoredRow;
  }

  const now = new Date().toISOString();
  const schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${previousUpdatedAt}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        owner_email: identity.email,
        schema_version: schemaVersion,
        state_payload: state,
        updated_at: now,
      }),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeModel(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}
