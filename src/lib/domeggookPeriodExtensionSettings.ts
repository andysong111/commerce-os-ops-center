export const DOMEGGOOK_TASK_NAME = "Commerce OS Domeggook Period Extension";

export type DomeggookLocalSettings = {
  accountId: string;
  scheduleTime: string;
  extensionDays: number;
  liveExecution: boolean;
  updatedAt: string | null;
};

export type DomeggookAccountSettings = DomeggookLocalSettings & {
  enabled: boolean;
  debugPort: number;
};

export type DomeggookAccountsSettings = {
  accounts: DomeggookAccountSettings[];
  updatedAt: string | null;
};

export const DEFAULT_DOMEGGOOK_SETTINGS: DomeggookLocalSettings = {
  accountId: "everysale999",
  scheduleTime: "00:10",
  extensionDays: 90,
  liveExecution: true,
  updatedAt: null,
};

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MIN_DEBUG_PORT = 9400;
const MAX_DEBUG_PORT = 9799;

export function normalizeDomeggookLocalSettings(
  value: Partial<DomeggookLocalSettings> | null | undefined,
): DomeggookLocalSettings {
  const accountId = String(value?.accountId ?? DEFAULT_DOMEGGOOK_SETTINGS.accountId).trim();
  const scheduleTime = String(value?.scheduleTime ?? DEFAULT_DOMEGGOOK_SETTINGS.scheduleTime).trim();
  const extensionDays = Number(value?.extensionDays ?? DEFAULT_DOMEGGOOK_SETTINGS.extensionDays);
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("도매꾹 아이디는 영문, 숫자, 점, 밑줄, 하이픈 3~50자로 입력하세요.");
  }
  if (!TIME_PATTERN.test(scheduleTime)) {
    throw new Error("실행시간은 24시간제 HH:mm 형식이어야 합니다.");
  }
  if (!Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > 90) {
    throw new Error("연장기간은 1~90일 사이의 정수여야 합니다.");
  }
  return {
    accountId,
    scheduleTime,
    extensionDays,
    liveExecution: value?.liveExecution !== false,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function buildDomeggookInstallArguments(settings: DomeggookLocalSettings) {
  return [
    "-At", settings.scheduleTime,
    "-Days", String(settings.extensionDays),
    "-AccountId", settings.accountId,
    ...(settings.liveExecution ? ["-Execute"] : []),
  ];
}

function stablePort(accountId: string) {
  let hash = 2166136261;
  for (const character of accountId.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return MIN_DEBUG_PORT + (hash % (MAX_DEBUG_PORT - MIN_DEBUG_PORT + 1));
}

export function normalizeDomeggookAccountsSettings(
  value: Partial<DomeggookAccountsSettings> | DomeggookLocalSettings | null | undefined,
): DomeggookAccountsSettings {
  const rawAccounts = Array.isArray((value as Partial<DomeggookAccountsSettings> | null)?.accounts)
    ? (value as Partial<DomeggookAccountsSettings>).accounts || []
    : value && typeof value === "object" && "accountId" in value
      ? [value as DomeggookLocalSettings]
      : [DEFAULT_DOMEGGOOK_SETTINGS];
  if (rawAccounts.length > 12) throw new Error("도매꾹 계정은 최대 12개까지 등록할 수 있습니다.");
  const usedIds = new Set<string>();
  const usedPorts = new Set<number>();
  const accounts = rawAccounts.map((raw, index) => {
    const base = normalizeDomeggookLocalSettings(raw);
    const normalizedId = base.accountId.toLowerCase();
    if (usedIds.has(normalizedId)) throw new Error(`중복된 도매꾹 아이디입니다: ${base.accountId}`);
    usedIds.add(normalizedId);
    let debugPort = Number((raw as Partial<DomeggookAccountSettings>).debugPort);
    if (!Number.isInteger(debugPort) || debugPort < MIN_DEBUG_PORT || debugPort > MAX_DEBUG_PORT || usedPorts.has(debugPort)) {
      debugPort = stablePort(base.accountId);
      while (usedPorts.has(debugPort)) {
        debugPort = debugPort >= MAX_DEBUG_PORT ? MIN_DEBUG_PORT : debugPort + 1;
      }
    }
    usedPorts.add(debugPort);
    return {
      ...base,
      scheduleTime: base.scheduleTime || `00:${String(10 + index * 5).padStart(2, "0")}`,
      enabled: (raw as Partial<DomeggookAccountSettings>).enabled !== false,
      debugPort,
    };
  });
  if (!accounts.length) throw new Error("최소 1개의 도매꾹 계정이 필요합니다.");
  return {
    accounts,
    updatedAt: typeof (value as Partial<DomeggookAccountsSettings> | null)?.updatedAt === "string"
      ? (value as Partial<DomeggookAccountsSettings>).updatedAt || null
      : null,
  };
}

export function domeggookTaskName(accountId: string) {
  const normalized = normalizeDomeggookLocalSettings({ accountId }).accountId;
  return `${DOMEGGOOK_TASK_NAME} - ${normalized}`;
}
