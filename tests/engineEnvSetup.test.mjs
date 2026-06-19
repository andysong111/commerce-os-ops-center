import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/engine-env-setup/page.tsx", "utf8");
const config = readFileSync("src/lib/engineEnvConfig.ts", "utf8");
const statusRoute = readFileSync("src/app/api/engine-env/status/route.ts", "utf8");
const saveRoute = readFileSync("src/app/api/engine-env/secrets/route.ts", "utf8");
const secretsLib = readFileSync("src/lib/githubActionsSecrets.ts", "utf8");
const runner = readFileSync("src/components/engine-runners/EngineRunnerConsole.tsx", "utf8");

test("environment setup page renders required Korean content", () => {
  assert.match(page, /엔진 환경변수 설정/);
  assert.match(page, /키워드 엔진 환경변수/);
  assert.match(config, /샵플링 로그인 ID/);
  assert.match(config, /샵플링 회사 ID/);
  assert.match(config, /샵플링 API 인증키/);
  assert.match(config, /샵플링 API 기본 주소/);
  assert.match(page, /GitHub Actions Secrets에 저장/);
  assert.match(page, /OPS CENTER에는 값이 저장되지 않습니다/);
  assert.match(page, /현재 상세페이지 엔진은 OPS CENTER에서 설정할 필수 환경변수가 없습니다/);
});

test("status and save APIs expose statuses without secret values and validate allowlists", () => {
  assert.match(statusRoute, /configured/);
  assert.match(statusRoute, /unknown/);
  assert.match(secretsLib, /GITHUB_ENGINE_ADMIN_TOKEN 권한을 확인해 주세요/);
  assert.match(saveRoute, /getEngineEnvConfig/);
  assert.match(saveRoute, /허용되지 않은 엔진입니다/);
  assert.match(saveRoute, /허용되지 않은 Secret 이름입니다/);
  assert.match(saveRoute, /value\.trim\(\)/);
  assert.match(secretsLib, /actions\/secrets\/public-key/);
  assert.match(secretsLib, /crypto_box_seal|__engineSecretEncryptForTest/);
  assert.match(saveRoute, /savedSecrets/);
  assert.doesNotMatch(saveRoute, /secretValues|localStorage|sessionStorage/);
});

test("runner failure diagnosis links to environment setup", () => {
  assert.match(runner, /키워드 엔진 환경변수가 부족해서 실패했습니다/);
  assert.match(runner, /LOGIN_ID, COMPANY_ID, API_AUTH_KEY, SHOPLING_BASE_URL/);
  assert.match(runner, /\/engine-env-setup/);
});

test("safety restrictions remain in place", () => {
  const combined = [page, statusRoute, saveRoute, secretsLib, runner].join("\n");
  assert.doesNotMatch(combined, /child_process|PowerShell\.exe|powershell/i);
  assert.doesNotMatch(combined, /Shopling API 실행|auto-publish|auto-apply/i);
  assert.doesNotMatch(combined, /operation history.*secret|secret.*operation history/i);
});
