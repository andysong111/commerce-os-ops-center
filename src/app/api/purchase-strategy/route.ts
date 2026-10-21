import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  appendPurchaseStrategyConfigEvent,
  appendPurchaseStrategyProductEvent,
  buildPurchaseStrategyConfigUpdate,
  loadPurchaseStrategyState,
  normalizePurchaseStrategyBarcode,
  PurchaseStrategyError,
} from "@/lib/purchaseStrategyState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "cache-control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS });
}

function unauthorized() {
  return json(
    {
      ok: false,
      code: "PURCHASE_STRATEGY_UNAUTHORIZED",
      message: "영구 발주 정책을 조회하거나 변경할 권한이 필요합니다.",
    },
    401,
  );
}

function bodyObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PurchaseStrategyError(
      "PURCHASE_STRATEGY_REQUEST_INVALID",
      "요청 본문은 객체여야 합니다.",
    );
  }
  return value as Record<string, unknown>;
}

function exactBodyKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new PurchaseStrategyError(
      "PURCHASE_STRATEGY_REQUEST_FIELDS_INVALID",
      `요청 필드는 ${expected.join(", ")}만 허용됩니다.`,
    );
  }
}

function stateResponse(state: Awaited<ReturnType<typeof loadPurchaseStrategyState>>) {
  return {
    ok: true,
    scope: "PERMANENT_PURCHASE_STRATEGY",
    temporaryDraftExclusionsStoredHere: false,
    config: state.config,
    states: state.states,
    history: {
      config: state.configHistory,
      products: state.productHistory,
    },
    bounds: {
      latestRowsPerOperationType: state.readLimitPerOperationType,
      configHistoryMayBeTruncated: state.configHistoryMayBeTruncated,
      productHistoryMayBeTruncated: state.productHistoryMayBeTruncated,
    },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof PurchaseStrategyError) {
    const conflict = [
      "PURCHASE_STRATEGY_CONFIG_VERSION_STALE",
      "PURCHASE_STRATEGY_ALREADY_DISCONTINUED",
      "PURCHASE_STRATEGY_NOT_DISCONTINUED",
      "PURCHASE_STRATEGY_CONFIG_VERSION_CONFLICT",
      "PURCHASE_STRATEGY_WRITE_CONFLICT",
    ].includes(error.code);
    const unavailable = [
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "PURCHASE_STRATEGY_READ_FAILED",
      "PURCHASE_STRATEGY_READ_UNVERIFIED",
      "PURCHASE_STRATEGY_READ_LIMIT",
      "PURCHASE_STRATEGY_CHANGED_DURING_READ",
      "PURCHASE_STRATEGY_PARTIAL_PAGE",
      "PURCHASE_STRATEGY_PAGE_DRIFT",
      "PURCHASE_STRATEGY_APPEND_FAILED",
      "PURCHASE_STRATEGY_WRITE_NOT_VISIBLE",
    ].includes(error.code);
    return json(
      { ok: false, code: error.code, message: error.message },
      conflict ? 409 : unavailable ? 503 : 400,
    );
  }
  return json(
    {
      ok: false,
      code: "PURCHASE_STRATEGY_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "영구 발주 정책 작업을 처리하지 못했습니다.",
    },
    500,
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    return json(stateResponse(await loadPurchaseStrategyState()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = bodyObject(await request.json());
    const action = body.action;
    if (
      action !== "UPDATE_CONFIG" &&
      action !== "DISCONTINUE" &&
      action !== "RESTORE"
    ) {
      throw new PurchaseStrategyError(
        "PURCHASE_STRATEGY_ACTION_INVALID",
        "action은 UPDATE_CONFIG, DISCONTINUE, RESTORE 중 하나여야 합니다.",
      );
    }

    const before = await loadPurchaseStrategyState();
    if (action === "UPDATE_CONFIG") {
      exactBodyKeys(body, ["action", "actor", "expectedVersion", "config"]);
      if (
        typeof body.expectedVersion !== "number" ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 1
      ) {
        throw new PurchaseStrategyError(
          "PURCHASE_STRATEGY_EXPECTED_VERSION_INVALID",
          "expectedVersion은 1 이상의 정수여야 합니다.",
        );
      }
      if (body.expectedVersion !== before.config.version) {
        throw new PurchaseStrategyError(
          "PURCHASE_STRATEGY_CONFIG_VERSION_STALE",
          `화면의 정책 버전 ${body.expectedVersion}이 현재 버전 ${before.config.version}과 다릅니다. 다시 조회한 뒤 저장하세요.`,
        );
      }
      const config = buildPurchaseStrategyConfigUpdate(
        body.config,
        before.config.version,
      );
      const stored = await appendPurchaseStrategyConfigEvent({
        actor: body.actor,
        config,
      });
      const after = await loadPurchaseStrategyState();
      if (
        after.config.version !== config.version ||
        !after.configHistory.some(
          (event) => event.sourceEventId === stored.sourceEventId,
        )
      ) {
        throw new PurchaseStrategyError(
          "PURCHASE_STRATEGY_WRITE_NOT_VISIBLE",
          "정책 설정 저장 직후 재조회 검증에 실패했습니다.",
        );
      }
      return json(
        {
          ...stateResponse(after),
          action,
          sourceEventId: stored.sourceEventId,
          message: `발주 정책 설정을 버전 ${config.version}으로 저장했습니다.`,
        },
        201,
      );
    }

    exactBodyKeys(body, ["action", "barcode", "reason", "actor"]);
    const barcode = normalizePurchaseStrategyBarcode(body.barcode);
    const current = before.states.find((row) => row.barcode === barcode);
    if (action === "DISCONTINUE" && current?.status === "DISCONTINUED") {
      throw new PurchaseStrategyError(
        "PURCHASE_STRATEGY_ALREADY_DISCONTINUED",
        `${barcode}는 이미 영구 발주 제외 상태입니다.`,
      );
    }
    if (action === "RESTORE" && current?.status !== "DISCONTINUED") {
      throw new PurchaseStrategyError(
        "PURCHASE_STRATEGY_NOT_DISCONTINUED",
        `${barcode}는 복구할 영구 발주 제외 상태가 없습니다.`,
      );
    }
    const stored = await appendPurchaseStrategyProductEvent({
      action,
      barcode,
      reason: body.reason,
      actor: body.actor,
      expectedPreviousSourceEventId:
        before.productHistory.find((event) => event.barcode === barcode)
          ?.sourceEventId ?? null,
    });
    const after = await loadPurchaseStrategyState();
    const savedState = after.states.find((row) => row.barcode === barcode);
    const expectedStatus = action === "DISCONTINUE" ? "DISCONTINUED" : "ACTIVE";
    if (
      savedState?.status !== expectedStatus ||
      !after.productHistory.some(
        (event) => event.sourceEventId === stored.sourceEventId,
      )
    ) {
      throw new PurchaseStrategyError(
        "PURCHASE_STRATEGY_WRITE_NOT_VISIBLE",
        "영구 발주 상태 저장 직후 재조회 검증에 실패했습니다.",
      );
    }
    return json(
      {
        ...stateResponse(after),
        action,
        sourceEventId: stored.sourceEventId,
        changed: savedState,
        message:
          action === "DISCONTINUE"
            ? `${barcode}를 영구 발주 제외(단종)로 지정했습니다.`
            : `${barcode}의 영구 발주 제외를 해제했습니다.`,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
