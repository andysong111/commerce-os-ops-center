export type EngineEnvKind = "keyword_engine";

export type EngineSecretDefinition = {
  name: "LOGIN_ID" | "COMPANY_ID" | "API_AUTH_KEY" | "SHOPLING_BASE_URL";
  label: string;
  helperText: string;
  placeholder?: string;
};

export type EngineEnvConfig = {
  engine: EngineEnvKind;
  title: string;
  repoOwner: string;
  repoName: string;
  repo: string;
  secrets: readonly EngineSecretDefinition[];
};

export const keywordEngineSecrets: readonly EngineSecretDefinition[] = [
  { name: "LOGIN_ID", label: "샵플링 로그인 ID", helperText: "샵플링 API 로그인에 사용하는 ID를 입력합니다." },
  { name: "COMPANY_ID", label: "샵플링 회사 ID", helperText: "샵플링 API 호출에 필요한 회사 ID를 입력합니다." },
  { name: "API_AUTH_KEY", label: "샵플링 API 인증키", helperText: "샵플링에서 발급받은 API 인증키를 입력합니다." },
  { name: "SHOPLING_BASE_URL", label: "샵플링 API 기본 주소", helperText: "키워드 엔진이 호출할 샵플링 API 기본 주소입니다.", placeholder: "예: https://api.shopling.co.kr 또는 기존 키워드 엔진에서 사용하는 주소" },
];

export const engineEnvConfigs: Record<EngineEnvKind, EngineEnvConfig> = {
  keyword_engine: {
    engine: "keyword_engine",
    title: "키워드 엔진 환경변수",
    repoOwner: "andysong111",
    repoName: "andysong111-keyword-engine-soon",
    repo: "andysong111/andysong111-keyword-engine-soon",
    secrets: keywordEngineSecrets,
  },
};

export function getEngineEnvConfig(engine: string | null): EngineEnvConfig | null {
  if (engine === "keyword_engine") return engineEnvConfigs.keyword_engine;
  return null;
}

export function getEngineAdminToken() {
  return process.env.GITHUB_ENGINE_ADMIN_TOKEN?.trim() || process.env.GITHUB_ENGINE_DISPATCH_TOKEN?.trim() || "";
}
