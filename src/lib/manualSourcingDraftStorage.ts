export const MANUAL_SOURCING_DRAFT_STORAGE_PREFIX = "commerce-os.manual-sourcing-intake.v2";
export const LEGACY_MANUAL_SOURCING_DRAFT_STORAGE_PREFIX = "commerce-os.manual-sourcing-intake.v1";
export const MANUAL_SOURCING_DRAFT_COMMITTED_EVENT = "commerce-os:manual-sourcing-draft-committed";

type StorageKeys = Pick<Storage, "key" | "length">;

function queryContext(search: string) {
  const params = new URLSearchParams(search);
  const draftId = params.get("replace")?.trim() || params.get("draftId")?.trim();
  if (draftId) return { stable: draftId, legacy: draftId, month: "" };

  const date = params.get("date")?.trim() || "";
  const month = /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date.slice(0, 7) : "";
  return {
    stable: month ? `month-${month}` : "default",
    legacy: date || "default",
    month,
  };
}

export function manualSourcingDraftStorageKey(
  pathname: string,
  search: string,
  formId?: string,
) {
  return [
    MANUAL_SOURCING_DRAFT_STORAGE_PREFIX,
    pathname,
    formId || "manual",
    queryContext(search).stable,
  ].join(":");
}

export function legacyManualSourcingDraftStorageKeys(
  storage: StorageKeys,
  pathname: string,
  search: string,
  formId?: string,
) {
  const context = queryContext(search);
  const prefix = [
    LEGACY_MANUAL_SOURCING_DRAFT_STORAGE_PREFIX,
    pathname,
    formId || "manual",
    "",
  ].join(":");
  const exactSuffix = `:${context.legacy}`;
  const monthSuffix = context.month ? new RegExp(`:${context.month}-\\d{2}$`, "u") : null;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    if (key.endsWith(exactSuffix) || monthSuffix?.test(key)) keys.push(key);
  }
  return [...new Set(keys)];
}
