import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchStorageJson,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  buildProductLaunchListIndex,
  buildProductLaunchListSnapshot,
  parseProductLaunchListSnapshot,
  queryProductLaunchListPage,
  withProductLaunchListSnapshot,
} from "@/lib/productLaunchTrackerListSnapshot";
import {
  applyProductLaunchTrackerMutation,
  buildProductLaunchTrackerIndex,
  getProductLaunchTrackerItem,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";
import {
  queryProductLaunchNormalizedPage,
  readProductLaunchNormalizedItem,
  readProductLaunchNormalizedItems,
  readProductLaunchNormalizedWorkspace,
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";

const TABLE_NAME = "product_launch_tracker_states";
export const maxDuration = 90;

const HUMAN_READ_TIMEOUT_MS = 4_000;
const MUTATION_READ_TIMEOUT_MS = 15_000;
const MUTATION_WRITE_TIMEOUT_MS = 20_000;
const mutationQueues = new Map<string, Promise<unknown>>();

type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
  owner_email?: unknown;
};

type ListStoredRow = {
  list_snapshot?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};

type Config = { supabaseUrl: string; secretKey: string };
type Identity = { userId: string; email: string };
type ReadMode = "page" | "item" | "items" | "export";

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const rawMode = request.nextUrl.searchParams.get("mode") || "page";
  if (!isReadMode(rawMode)) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_MODE_NOT_SUPPORTED",
        message: "지원하지 않는 진행관리 조회 방식입니다.",
      },
      { status: 400 },
    );
  }
  const mode: ReadMode = rawMode;

  if (mode === "export") {
    try {
      return await legacyExportResponse(config.value, identity.value.userId);
    } catch (error) {
      return workflowUnavailableResponse(error);
    }
  }

  const requestedIds = mode === "items" ? requestedItemIds(request) : [];
  if (mode === "items") {
    const invalid = validateRequestedItemIds(requestedIds);
    if (invalid) return invalid;
  }
  const itemId =
    mode === "item"
      ? String(request.nextUrl.searchParams.get("id") ?? "").trim()
      : "";

  let workspace: Awaited<ReturnType<typeof readProductLaunchNormalizedWorkspace>>;
  try {
    workspace = await withDeadline(
      readProductLaunchNormalizedWorkspace(config.value, identity.value.userId),
      HUMAN_READ_TIMEOUT_MS,
      "OPS Workflow 연결이 4초를 초과했습니다.",
    );
  } catch (error) {
    return degradedLegacyRead(
      config.value,
      identity.value.userId,
      request,
      mode,
      requestedIds,
      itemId,
      error,
    );
  }

  try {
    if (mode === "page" && workspace?.normalized_read_enabled === true) {
      try {
        const page = await withDeadline(
          queryProductLaunchNormalizedPage(
            config.value,
            identity.value.userId,
            workspace,
            pageQuery(request),
          ),
          HUMAN_READ_TIMEOUT_MS,
          "OPS Workflow 목록 조회가 4초를 초과했습니다.",
        );
        return Response.json({
          ok: true,
          stateExists: true,
          ...page,
          policy: isRecord(workspace.policy) ? workspace.policy : null,
          sourceImportedAt: nullableText(workspace.source_imported_at),
          updatedAt:
            nullableText(workspace.source_state_updated_at) ??
            nullableText(workspace.updated_at),
          schemaVersion: numberOrNull(workspace.schema_version),
          listSource: "normalized",
          workflowSource: "normalized",
        });
      } catch (error) {
        return degradedLegacyRead(
          config.value,
          identity.value.userId,
          request,
          mode,
          requestedIds,
          itemId,
          error,
        );
      }
    }

    if (mode === "items") {
      if (workspace?.normalized_read_enabled === true) {
        try {
          const items = await withDeadline(
            readProductLaunchNormalizedItems(
              config.value,
              identity.value.userId,
              requestedIds,
            ),
            HUMAN_READ_TIMEOUT_MS,
            "OPS Workflow 상품 상세 조회가 4초를 초과했습니다.",
          );
          if (items.length === requestedIds.length) {
            return Response.json({
              ok: true,
              stateExists: true,
              items,
              updatedAt:
                nullableText(workspace.source_state_updated_at) ??
                nullableText(workspace.updated_at),
              schemaVersion: numberOrNull(workspace.schema_version),
              workflowSource: "normalized",
            });
          }
        } catch (error) {
          console.warn("Normalized Product Launch items read failed; using legacy fallback", error);
        }
      }
      return legacyItemsResponse(config.value, identity.value.userId, requestedIds);
    }

    if (mode === "item") {
      if (workspace?.normalized_read_enabled === true) {
        try {
          const item = await withDeadline(
            readProductLaunchNormalizedItem(
              config.value,
              identity.value.userId,
              itemId,
            ),
            HUMAN_READ_TIMEOUT_MS,
            "OPS Workflow 상품 상세 조회가 4초를 초과했습니다.",
          );
          if (item) {
            return Response.json({
              ok: true,
              stateExists: true,
              item,
              policy: isRecord(workspace.policy) ? workspace.policy : null,
              updatedAt:
                nullableText(workspace.source_state_updated_at) ??
                nullableText(workspace.updated_at),
              schemaVersion: numberOrNull(workspace.schema_version),
              workflowSource: "normalized",
            });
          }
        } catch (error) {
          console.warn("Normalized Product Launch item read failed; using legacy fallback", error);
        }
      }
      return legacyItemResponse(config.value, identity.value.userId, itemId);
    }

    return legacyPageResponse(config.value, identity.value.userId, request);
  } catch (error) {
    return workflowUnavailableResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRODUCT_LAUNCH_TRACKER_MUTATION",
        message: "변경 요청 JSON이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await enqueueMutation(identity.value.userId, () =>
      mutateStateWithRetry(config.value, identity.value, input),
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "진행관리 저장소 응답 제한시간을 초과했습니다. 잠시 후 다시 시도하세요."
        : error instanceof Error
          ? error.message
          : "진행관리 데이터를 저장하지 못했습니다.";
    console.error(
      JSON.stringify({
        event: "product_launch_tracker_mutation_failed",
        operation: isRecord(input) ? String(input.operation ?? "").trim() : "",
        errorName: error instanceof Error ? error.name : "UnknownError",
        message:
          error instanceof Error
            ? error.message.slice(0, 240)
            : String(error ?? "").slice(0, 240),
      }),
    );
    const status = message.includes("찾지 못")
      ? 404
      : message.includes("동시에")
        ? 409
        : /필요|선택|지원하지|최대|올바르지/.test(message)
          ? 400
          : 503;
    return Response.json(
      {
        ok: false,
        code:
          status === 409
            ? "PRODUCT_LAUNCH_TRACKER_CONCURRENT_UPDATE"
            : "PRODUCT_LAUNCH_TRACKER_MUTATION_FAILED",
        message,
      },
      { status },
    );
  }
}

function pageQuery(request: NextRequest) {
  return {
    page: request.nextUrl.searchParams.get("page"),
    pageSize: request.nextUrl.searchParams.get("pageSize"),
    search: request.nextUrl.searchParams.get("search"),
    batch: request.nextUrl.searchParams.get("batch"),
    assignee: request.nextUrl.searchParams.get("assignee"),
    overall: request.nextUrl.searchParams.get("overall"),
    unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
    sort: request.nextUrl.searchParams.get("sort"),
    direction: request.nextUrl.searchParams.get("direction"),
  };
}

function requestedItemIds(request: NextRequest) {
  return [
    ...new Set(
      request.nextUrl.searchParams
        .getAll("id")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function validateRequestedItemIds(requestedIds: string[]) {
  if (!requestedIds.length) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_IDS_REQUIRED",
        message: "불러올 상품 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }
  if (requestedIds.length > 100) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_LIMIT_EXCEEDED",
        message: "한 번에 최대 100개 상품까지 불러올 수 있습니다.",
      },
      { status: 400 },
    );
  }
  return null;
}

async function degradedLegacyRead(
  config: Config,
  ownerId: string,
  request: NextRequest,
  mode: Exclude<ReadMode, "export">,
  requestedIds: string[],
  itemId: string,
  normalizedError: unknown,
) {
  try {
    const response =
      mode === "page"
        ? await legacyPageResponse(config, ownerId, request)
        : mode === "items"
          ? await legacyItemsResponse(config, ownerId, requestedIds)
          : await legacyItemResponse(config, ownerId, itemId);
    response.headers.set("X-Commerce-OS-Workflow-Fallback", "legacy-fast");
    return response;
  } catch (legacyError) {
    console.error("Product Launch normalized and legacy reads both failed", {
      normalizedError,
      legacyError,
    });
    return workflowUnavailableResponse(legacyError, normalizedError);
  }
}

function workflowUnavailableResponse(error: unknown, primaryError?: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : primaryError instanceof Error
        ? primaryError.message
        : "OPS Workflow를 불러오지 못했습니다.";
  return Response.json(
    {
      ok: false,
      code: "PRODUCT_LAUNCH_TRACKER_WORKFLOW_UNAVAILABLE",
      message,
      retryable: true,
    },
    { status: 503 },
  );
}

async function legacyExportResponse(config: Config, ownerId: string) {
  const row = (await readProductLaunchState(config, ownerId)) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) {
    return Response.json({
      ok: true,
      stateExists: false,
      updatedAt: null,
      schemaVersion: null,
    });
  }
  return Response.json({
    ok: true,
    stateExists: true,
    state: row.state_payload,
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
    workflowSource: "legacy-export",
  });
}

async function legacyPageResponse(
  config: Config,
  ownerId: string,
  request: NextRequest,
) {
  const row = await readLegacyListSnapshotFast(config, ownerId);
  if (!row) {
    return Response.json({
      ok: true,
      stateExists: false,
      updatedAt: null,
      schemaVersion: null,
    });
  }
  const snapshot = parseProductLaunchListSnapshot(row.list_snapshot);
  if (!snapshot) {
    throw new Error("OPS Workflow 정규화 전환 대기 중입니다.");
  }
  const index = buildProductLaunchListIndex(snapshot);
  const page = queryProductLaunchListPage(index, pageQuery(request));
  return Response.json({
    ok: true,
    stateExists: true,
    ...page,
    policy: index.snapshot.policy ?? null,
    sourceImportedAt: index.snapshot.sourceImportedAt ?? null,
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
    listSource: "legacy-fast-fallback",
    workflowSource: "legacy-fast-fallback",
  });
}

async function legacyItemResponse(config: Config, ownerId: string, itemId: string) {
  const row = await readLegacyStateFast(config, ownerId);
  if (!row || !isRecord(row.state_payload)) {
    return Response.json({ ok: true, stateExists: false, updatedAt: null });
  }
  const index = buildProductLaunchTrackerIndex(
    row.state_payload as ProductLaunchTrackerState,
  );
  const item = getProductLaunchTrackerItem(index, itemId);
  if (!item) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
        message: "상품 기록을 찾지 못했습니다.",
      },
      { status: 404 },
    );
  }
  return Response.json({
    ok: true,
    stateExists: true,
    item,
    policy: index.state.policy ?? null,
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
    workflowSource: "legacy-fast-fallback",
  });
}

async function legacyItemsResponse(
  config: Config,
  ownerId: string,
  requestedIds: string[],
) {
  const row = await readLegacyStateFast(config, ownerId);
  if (!row || !isRecord(row.state_payload)) {
    return Response.json({ ok: true, stateExists: false, updatedAt: null });
  }
  const index = buildProductLaunchTrackerIndex(
    row.state_payload as ProductLaunchTrackerState,
  );
  const items = requestedIds
    .map((id) => getProductLaunchTrackerItem(index, id))
    .filter(Boolean);
  if (items.length !== requestedIds.length) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_ITEMS_NOT_FOUND",
        message: "일부 상품 기록을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
      },
      { status: 404 },
    );
  }
  return Response.json({
    ok: true,
    stateExists: true,
    items,
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
    workflowSource: "legacy-fast-fallback",
  });
}

async function readLegacyListSnapshotFast(config: Config, ownerId: string) {
  const params = new URLSearchParams({
    select: `list_snapshot:state_payload->${PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD},updated_at,schema_version`,
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    { attempts: 1, timeoutMs, retryDelaysMs: [] },
  );
  return Array.isArray(body) ? (body[0] as ListStoredRow | undefined) ?? null : null;
}

async function readLegacyStateFast(
  config: Config,
  ownerId: string,
  timeoutMs = HUMAN_READ_TIMEOUT_MS,
) {
  const params = new URLSearchParams({
    select: "state_payload,updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    { attempts: 1, timeoutMs: HUMAN_READ_TIMEOUT_MS, retryDelaysMs: [] },
  );
  return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
}

async function mutateStateWithRetry(
  config: Config,
  identity: Identity,
  input: unknown,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readLegacyStateFast(
      config,
      identity.userId,
      MUTATION_READ_TIMEOUT_MS,
    );
    if (!row || !isRecord(row.state_payload)) {
      throw new Error("저장된 진행관리 상태를 찾지 못했습니다.");
    }

    const mutation = applyProductLaunchTrackerMutation(
      row.state_payload as ProductLaunchTrackerState,
      input,
    );
    const persistedState = withProductLaunchListSnapshot(mutation.state);
    const saved = await conditionalWriteState(
      config,
      identity,
      persistedState,
      nullableText(row.updated_at),
    );
    if (!saved) continue;

    const index = buildProductLaunchTrackerIndex(persistedState);
    const updatedAt = nullableText(saved.updated_at) || new Date().toISOString();
    const schemaVersion = numberOrNull(saved.schema_version) ?? 3;
    let normalizedSynced = true;
    try {
      const sync = await syncProductLaunchNormalizedChangedItems(
        config,
        identity,
        persistedState,
        updatedAt,
        mutation.changedIds,
      );
      normalizedSynced = sync.synced === true;
    } catch (error) {
      normalizedSynced = false;
      console.error("Product Launch normalized mirror sync failed", error);
    }
    if (!normalizedSynced) {
      try {
        await setProductLaunchNormalizedReadEnabled(
          config,
          identity.userId,
          false,
        );
      } catch (error) {
        console.error("Product Launch normalized read disable failed", error);
      }
    }

    const changedItems = mutation.changedIds
      .map((id) => index.summariesById.get(id))
      .filter(Boolean)
      .map((summary) => {
        const { searchText: _searchText, ...safeSummary } = summary!;
        return safeSummary;
      });

    return {
      updatedAt,
      schemaVersion,
      changedIds: mutation.changedIds,
      createdIds: mutation.createdIds,
      items: changedItems,
      counts: index.counts,
      filterOptions: index.filterOptions,
      normalizedSynced,
    };
  }

  throw new Error(
    "다른 저장과 동시에 변경되었습니다. 최신 상태를 다시 불러온 뒤 한 번 더 시도하세요.",
  );
}

async function conditionalWriteState(
  config: Config,
  identity: Identity,
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) {
    return (await writeProductLaunchState(config, identity, state)) as StoredRow;
  }

  const now = new Date().toISOString();
  const schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  const params = new URLSearchParams({
    select: "updated_at,schema_version",
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${previousUpdatedAt}`,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MUTATION_WRITE_TIMEOUT_MS);
  try {
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
        signal: controller.signal,
      },
    );
    const body = await readResponseJson(response);
    if (!response.ok) {
      throw new Error(readProductLaunchError(body, response.status));
    }
    return Array.isArray(body)
      ? (body[0] as StoredRow | undefined) ?? null
      : null;
  } finally {
    clearTimeout(timeout);
  }
}

function enqueueMutation<T>(ownerId: string, operation: () => Promise<T>) {
  const previous = mutationQueues.get(ownerId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(ownerId, settled);
  void settled.finally(() => {
    if (mutationQueues.get(ownerId) === settled) mutationQueues.delete(ownerId);
  });
  return current;
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isReadMode(value: string): value is ReadMode {
  return value === "page" || value === "item" || value === "items" || value === "export";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
